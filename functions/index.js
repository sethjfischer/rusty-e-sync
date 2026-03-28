require('dotenv').config({ path: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev' })

exports.stripe = require('./stripe')
// exports.cms = require('./cms')

// START @edge/firebase functions
const { kvMirrorRetryWorker } = require('./kv/kvRetryWorker')
exports.kvMirrorRetryWorker = kvMirrorRetryWorker
exports.edgeFirebase = require('./edgeFirebase')
// END @edge/firebase functions

// START EXTRA EDGE functions
exports.cms = require('./cms')
exports.history = require('./history')
// END EXTRA EDGE functions
