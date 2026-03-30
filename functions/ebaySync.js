const crypto = require('crypto')
const { onCall, onRequest, onSchedule, HttpsError, logger, db, admin } = require('./config.js')

const assertCallableUser = (request) => {
  if (!request?.auth?.uid)
    throw new HttpsError('unauthenticated', 'Authentication required.')
  if (request?.data?.uid !== request.auth.uid)
    throw new HttpsError('permission-denied', 'UID mismatch.')
}

const normalizeString = value => String(value || '').trim()

const getSiteRef = ({ orgId, siteId }) => db
  .collection('organizations')
  .doc(orgId)
  .collection('sites')
  .doc(siteId)

const normalizeSettingsInput = (settings = {}) => {
  const inventoryMode = ['safety-first', 'ebay-wins', 'site-wins'].includes(settings.inventoryMode)
    ? settings.inventoryMode
    : 'safety-first'

  const ebayEnvironment = settings.ebayEnvironment === 'sandbox'
    ? 'sandbox'
    : 'production'

  const syncIntervalMinutes = Math.min(60, Math.max(1, Number(settings.syncIntervalMinutes || 2)))

  return {
    enableSync: Boolean(settings.enableSync),
    useWebhooks: settings.useWebhooks !== false,
    inventoryMode,
    syncIntervalMinutes,
    ebayEnvironment,
    appId: normalizeString(settings.appId),
    devId: normalizeString(settings.devId),
    certId: normalizeString(settings.certId),
    ruName: normalizeString(settings.ruName),
    refreshToken: normalizeString(settings.refreshToken),
  }
}

const maskSecret = (value) => {
  const text = normalizeString(value)
  if (!text)
    return ''
  if (text.length <= 8)
    return '*'.repeat(text.length)
  return `${text.slice(0, 4)}${'*'.repeat(text.length - 8)}${text.slice(-4)}`
}

const getEncryptionKey = () => {
  const keySource = normalizeString(process.env.EBAY_SYNC_SECRET)
  if (!keySource)
    return null
  return crypto.createHash('sha256').update(keySource).digest()
}

const encryptSecret = (plaintext) => {
  const text = normalizeString(plaintext)
  if (!text)
    return ''

  const key = getEncryptionKey()
  if (!key)
    return text

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`
}

exports.saveSettings = onCall(async (request) => {
  assertCallableUser(request)

  const orgId = normalizeString(request.data?.orgId)
  const siteId = normalizeString(request.data?.siteId)

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'orgId and siteId are required.')

  const settings = normalizeSettingsInput(request.data?.settings || {})
  const siteRef = getSiteRef({ orgId, siteId })
  const siteSnap = await siteRef.get()

  if (!siteSnap.exists)
    throw new HttpsError('not-found', 'Site not found.')

  const encryptedRefreshToken = encryptSecret(settings.refreshToken)

  await siteRef
    .collection('settings')
    .doc('ebaySync')
    .set({
      ...settings,
      refreshToken: encryptedRefreshToken,
      refreshTokenMasked: maskSecret(settings.refreshToken),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    }, { merge: true })

  return {
    success: true,
    message: 'Saved eBay sync settings.',
    hasSecret: Boolean(settings.refreshToken),
  }
})

exports.getSettings = onCall(async (request) => {
  assertCallableUser(request)

  const orgId = normalizeString(request.data?.orgId)
  const siteId = normalizeString(request.data?.siteId)

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'orgId and siteId are required.')

  const siteRef = getSiteRef({ orgId, siteId })
  const settingsSnap = await siteRef.collection('settings').doc('ebaySync').get()
  const data = settingsSnap.exists ? settingsSnap.data() : {}

  return {
    settings: {
      enableSync: Boolean(data?.enableSync),
      useWebhooks: data?.useWebhooks !== false,
      inventoryMode: normalizeString(data?.inventoryMode) || 'safety-first',
      syncIntervalMinutes: Number(data?.syncIntervalMinutes || 2),
      ebayEnvironment: normalizeString(data?.ebayEnvironment) || 'production',
      appId: normalizeString(data?.appId),
      devId: normalizeString(data?.devId),
      certId: normalizeString(data?.certId),
      ruName: normalizeString(data?.ruName),
      refreshTokenMasked: normalizeString(data?.refreshTokenMasked),
      updatedAt: data?.updatedAt || null,
      updatedBy: normalizeString(data?.updatedBy),
    },
  }
})

exports.runNow = onCall(async (request) => {
  assertCallableUser(request)

  const orgId = normalizeString(request.data?.orgId)
  const siteId = normalizeString(request.data?.siteId)
  const reason = normalizeString(request.data?.reason) || 'manual'

  if (!orgId || !siteId)
    throw new HttpsError('invalid-argument', 'orgId and siteId are required.')

  const jobsRef = db.collection('ebay-sync-jobs')
  const jobRef = jobsRef.doc()

  await jobRef.set({
    orgId,
    siteId,
    reason,
    status: 'queued',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth.uid,
    source: 'callable',
  })

  return {
    success: true,
    jobId: jobRef.id,
  }
})

exports.webhook = onRequest(async (request, response) => {
  const signature = normalizeString(request.headers['x-ebay-signature'])
  const webhookKey = normalizeString(process.env.EBAY_WEBHOOK_KEY)

  if (webhookKey && signature !== webhookKey) {
    response.status(401).json({ success: false, message: 'Invalid signature.' })
    return
  }

  const payload = request.body || {}
  const orgId = normalizeString(payload.orgId)
  const siteId = normalizeString(payload.siteId)
  const eventType = normalizeString(payload.eventType) || 'unknown'

  const eventRef = db.collection('ebay-sync-events').doc()
  await eventRef.set({
    orgId,
    siteId,
    eventType,
    payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'webhook',
  })

  if (orgId && siteId) {
    await db.collection('ebay-sync-jobs').add({
      orgId,
      siteId,
      reason: `webhook:${eventType}`,
      status: 'queued',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'webhook',
      eventId: eventRef.id,
    })
  }

  response.json({ success: true })
})

exports.worker = onSchedule({ schedule: 'every 2 minutes', timeoutSeconds: 300 }, async () => {
  const queuedJobs = await db
    .collection('ebay-sync-jobs')
    .where('status', '==', 'queued')
    .limit(20)
    .get()

  if (queuedJobs.empty) {
    logger.log('ebaySync worker: no queued jobs')
    return
  }

  for (const jobDoc of queuedJobs.docs) {
    const jobData = jobDoc.data() || {}
    const orgId = normalizeString(jobData.orgId)
    const siteId = normalizeString(jobData.siteId)

    if (!orgId || !siteId) {
      await jobDoc.ref.set({
        status: 'error',
        error: 'Missing orgId or siteId',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      continue
    }

    await jobDoc.ref.set({
      status: 'processing',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

    try {
      // Placeholder for API sync pipeline:
      // 1) Pull eBay inventory deltas.
      // 2) Apply safe inventory merge into site products.
      // 3) Push local product updates with syncEnabled=true back to eBay.
      await jobDoc.ref.set({
        status: 'done',
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    catch (error) {
      await jobDoc.ref.set({
        status: 'error',
        error: error?.message || 'Unknown sync error',
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  }
})
