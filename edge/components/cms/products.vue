<script setup>
import { Box, FilePenLine, Loader2, RefreshCw, Settings, Trash } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

const props = defineProps({
  site: {
    type: String,
    required: true,
  },
})

const edgeFirebase = inject('edgeFirebase')
const route = useRoute()
const router = useRouter()

const collection = 'products'
const NO_TAGS_FILTER_VALUE = '__no_tags__'
const ALL_SITES_FILTER_VALUE = 'all'

const docId = computed(() => {
  const value = String(route.params?.docId || '').trim()
  return value
})
const currentSite = computed(() => String(props.site || '').trim())
const productsBaseRoute = computed(() => {
  if (currentSite.value)
    return `/app/dashboard/sites/${currentSite.value}/products`
  return '/app/dashboard/products'
})

const buildProductSchema = (showEbayFields, tagItems = []) => {
  const schema = {
    sites: {
      bindings: {
        'field-type': 'tags',
        'label': 'Sites',
        'helper': 'Use "all" to show on every site, or set one or more site IDs.',
      },
      cols: '12',
      value: [props.site || ALL_SITES_FILTER_VALUE],
    },
    name: { bindings: { 'field-type': 'text', 'label': 'Name', 'helper': 'Product name' }, cols: '12', value: '' },
    sku: { bindings: { 'field-type': 'text', 'label': 'SKU', 'helper': 'Unique stock keeping unit' }, cols: '6', value: '' },
    slug: { bindings: { 'field-type': 'text', 'label': 'Slug', 'helper': 'URL handle' }, cols: '6', value: '' },
    status: {
      bindings: {
        'field-type': 'select',
        'label': 'Status',
        'items': [
          { name: 'draft', title: 'Draft' },
          { name: 'active', title: 'Active' },
          { name: 'sold_out', title: 'Sold Out' },
          { name: 'archived', title: 'Archived' },
        ],
      },
      cols: '6',
      value: 'draft',
    },
    condition: {
      bindings: {
        'field-type': 'select',
        'label': 'Condition',
        'items': [
          { name: 'new', title: 'New' },
          { name: 'used', title: 'Used' },
          { name: 'refurbished', title: 'Refurbished' },
        ],
      },
      cols: '6',
      value: 'used',
    },
    price: {
      bindings: {
        'field-type': 'money',
        'label': 'Price',
        'show-toggle': false,
      },
      cols: '6',
      value: 0,
    },
    compareAtPrice: {
      bindings: {
        'field-type': 'money',
        'label': 'Compare At Price',
        'show-toggle': false,
      },
      cols: '6',
      value: 0,
    },
    quantity: { bindings: { 'field-type': 'integer', 'label': 'Inventory Qty' }, cols: '6', value: 1 },
    soldCount: { bindings: { 'field-type': 'integer', 'label': 'Sold Count' }, cols: '6', value: 0 },
    tags: {
      bindings: {
        'field-type': 'selectTags',
        'label': 'Tags',
        'helper': 'Product tags',
        'placeholder': 'Select tags',
        'allow-additions': true,
        'items': tagItems,
      },
      cols: '12',
      value: [],
    },
    image: { bindings: { 'field-type': 'text', 'label': 'Primary Image URL' }, cols: '12', value: '' },
    description: { bindings: { 'field-type': 'textarea', 'label': 'Description' }, cols: '12', value: '' },
  }

  if (showEbayFields) {
    schema.syncEnabled = { bindings: { 'field-type': 'boolean', 'label': 'Sync with eBay' }, cols: '6', value: true }
    schema.syncSource = { bindings: { 'field-type': 'select', 'label': 'Source of Truth', 'items': ['ebay', 'site'] }, cols: '6', value: 'ebay' }
    schema.ebayItemId = { bindings: { 'field-type': 'text', 'label': 'eBay Item ID' }, cols: '6', value: '' }
    schema.ebayOfferId = { bindings: { 'field-type': 'text', 'label': 'eBay Offer ID' }, cols: '6', value: '' }
    schema.syncStatus = { bindings: { 'field-type': 'select', 'label': 'Sync Status', 'items': ['not_synced', 'pending', 'synced', 'error'] }, cols: '6', value: 'not_synced' }
    schema.syncError = { bindings: { 'field-type': 'textarea', 'label': 'Last Sync Error' }, cols: '6', value: '' }
  }

  return schema
}

const state = reactive({
  filter: '',
  tab: 'products',
  settingsLoading: false,
  settingsRunningSync: false,
  settingsMessage: '',
  settingsError: '',
  productTagsFilter: [],
  productSitesFilter: [ALL_SITES_FILTER_VALUE],
  selectedProductDocIds: [],
  settingsForm: {
    enableSync: false,
    useWebhooks: true,
    inventoryMode: 'safety-first',
    syncIntervalMinutes: 2,
    ebayEnvironment: 'production',
    appId: '',
    devId: '',
    certId: '',
    ruName: '',
    refreshToken: '',
    refreshTokenMasked: '',
  },
  newDocSchema: buildProductSchema(false),
})

const productSchema = toTypedSchema(z.object({
  sites: z.array(z.string()).min(1, { message: 'At least one site target is required.' }),
  name: z.string({
    required_error: 'Name is required',
  }).min(1, { message: 'Name is required' }),
  sku: z.string({
    required_error: 'SKU is required',
  }).min(1, { message: 'SKU is required' }),
  price: z.coerce.number().min(0, { message: 'Price must be 0 or higher' }),
  quantity: z.coerce.number().int().min(0, { message: 'Inventory must be 0 or higher' }),
  tags: z.array(z.string()).optional(),
}))

const settingsSchema = toTypedSchema(z.object({
  enableSync: z.boolean(),
  useWebhooks: z.boolean(),
  inventoryMode: z.enum(['safety-first', 'ebay-wins', 'site-wins']),
  syncIntervalMinutes: z.coerce.number().int().min(1).max(60),
  ebayEnvironment: z.enum(['production', 'sandbox']),
  appId: z.string().optional(),
  devId: z.string().optional(),
  certId: z.string().optional(),
  ruName: z.string().optional(),
  refreshToken: z.string().optional(),
}))

const showSettings = computed(() => state.tab === 'settings')

const refreshEditorSchema = () => {
  state.newDocSchema = buildProductSchema(state.settingsForm.enableSync, tagOptions.value)
}

const normalizeStringArray = (value) => {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
}

const displaySiteValues = (sites) => {
  const list = normalizeStringArray(sites)
  if (!list.length)
    return 'All'
  return list.map(site => (site === ALL_SITES_FILTER_VALUE ? 'All' : site)).join(', ')
}

const productsCollection = computed(() => {
  return edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/products`] || {}
})

const siteFilterOptions = computed(() => {
  const base = [{ name: ALL_SITES_FILTER_VALUE, title: 'All' }]
  const sitesCollection = edgeFirebase.data?.[`${edgeGlobal.edgeState.organizationDocPath}/sites`] || {}
  const siteItems = Object.entries(sitesCollection)
    .filter(([siteId]) => String(siteId || '').trim() && siteId !== 'templates')
    .map(([siteId, siteDoc]) => ({ name: siteId, title: siteDoc?.name || siteId }))
    .sort((a, b) => a.title.localeCompare(b.title))

  return [...base, ...siteItems]
})

const tagOptions = computed(() => {
  const tagsSet = new Set()
  Object.values(productsCollection.value || {}).forEach((product) => {
    normalizeStringArray(product?.tags).forEach(tag => tagsSet.add(tag))
  })
  const tagItems = Array.from(tagsSet)
    .sort((a, b) => a.localeCompare(b))
    .map(tag => ({ name: tag, title: tag }))
  return [{ name: NO_TAGS_FILTER_VALUE, title: 'No Tags' }, ...tagItems]
})

const selectedProductCount = computed(() => state.selectedProductDocIds.length)

const filterProducts = (items = []) => {
  let filteredItems = Array.isArray(items) ? items : []

  const selectedSites = normalizeStringArray(state.productSitesFilter)
  const restrictBySite = selectedSites.length && !selectedSites.includes(ALL_SITES_FILTER_VALUE)
  if (restrictBySite) {
    filteredItems = filteredItems.filter((item) => {
      const itemSites = normalizeStringArray(item?.sites)
      if (itemSites.includes(ALL_SITES_FILTER_VALUE))
        return true
      return selectedSites.some(siteId => itemSites.includes(siteId))
    })
  }

  const selectedTags = normalizeStringArray(state.productTagsFilter)
  if (!selectedTags.length)
    return filteredItems

  const includeNoTags = selectedTags.includes(NO_TAGS_FILTER_VALUE)
  const explicitTags = selectedTags.filter(tag => tag !== NO_TAGS_FILTER_VALUE)

  return filteredItems.filter((item) => {
    const itemTags = normalizeStringArray(item?.tags)
    if (!itemTags.length)
      return includeNoTags
    return explicitTags.length
      ? itemTags.some(tag => explicitTags.includes(tag))
      : false
  })
}

const isProductSelected = docId => state.selectedProductDocIds.includes(docId)

const setProductSelection = (docId, selected) => {
  const shouldSelect = selected === true || selected === 'indeterminate'
  if (shouldSelect) {
    if (!state.selectedProductDocIds.includes(docId))
      state.selectedProductDocIds = [...state.selectedProductDocIds, docId]
    return
  }
  state.selectedProductDocIds = state.selectedProductDocIds.filter(id => id !== docId)
}

const clearSelectedProducts = () => {
  state.selectedProductDocIds = []
}

const getVisibleSelectionState = (visibleProducts) => {
  if (!visibleProducts.length)
    return false
  const selectedVisibleCount = visibleProducts.filter(item => isProductSelected(item.docId)).length
  if (selectedVisibleCount === 0)
    return false
  if (selectedVisibleCount === visibleProducts.length)
    return true
  return 'indeterminate'
}

const toggleVisibleSelection = (visibleProducts, selected) => {
  const shouldSelect = selected === true || selected === 'indeterminate'
  const visibleIds = visibleProducts.map(item => item.docId)
  if (!shouldSelect) {
    state.selectedProductDocIds = state.selectedProductDocIds.filter(id => !visibleIds.includes(id))
    return
  }
  const next = new Set(state.selectedProductDocIds)
  visibleIds.forEach(id => next.add(id))
  state.selectedProductDocIds = Array.from(next)
}

const deleteSelectedProducts = async () => {
  const selectedIds = [...state.selectedProductDocIds]
  if (!selectedIds.length)
    return
  if (typeof window !== 'undefined') {
    const confirmed = window.confirm(`Delete ${selectedIds.length} selected product${selectedIds.length === 1 ? '' : 's'}?`)
    if (!confirmed)
      return
  }

  for (const id of selectedIds) {
    await edgeFirebase.removeDoc(`${edgeGlobal.edgeState.organizationDocPath}/${collection}`, id)
  }
  state.selectedProductDocIds = []
}

const setTab = async (tab) => {
  if (tab === state.tab)
    return
  state.tab = tab
  if (tab === 'settings') {
    if (docId.value)
      await router.push(productsBaseRoute.value)
    await loadSettings({ includeStatusMessage: false })
  }
}

const resetSettingsMessages = () => {
  state.settingsMessage = ''
  state.settingsError = ''
}

const loadSettings = async ({ includeStatusMessage = false } = {}) => {
  if (includeStatusMessage)
    resetSettingsMessages()

  state.settingsLoading = true
  try {
    const response = await edgeFirebase.runFunction('ebaySync-getSettings', {
      uid: edgeFirebase.user.uid,
      orgId: edgeGlobal.edgeState.currentOrganization,
      siteId: props.site,
    })
    const settings = response?.data?.settings || {}
    state.settingsForm.enableSync = Boolean(settings.enableSync)
    state.settingsForm.useWebhooks = settings.useWebhooks !== false
    state.settingsForm.inventoryMode = ['safety-first', 'ebay-wins', 'site-wins'].includes(settings.inventoryMode)
      ? settings.inventoryMode
      : 'safety-first'
    state.settingsForm.syncIntervalMinutes = Number(settings.syncIntervalMinutes || 2)
    state.settingsForm.ebayEnvironment = settings.ebayEnvironment === 'sandbox' ? 'sandbox' : 'production'
    state.settingsForm.appId = String(settings.appId || '')
    state.settingsForm.devId = String(settings.devId || '')
    state.settingsForm.certId = String(settings.certId || '')
    state.settingsForm.ruName = String(settings.ruName || '')
    state.settingsForm.refreshToken = ''
    state.settingsForm.refreshTokenMasked = String(settings.refreshTokenMasked || '')
    refreshEditorSchema()
  }
  catch (error) {
    state.settingsError = error?.message || 'Unable to load eBay sync settings.'
    refreshEditorSchema()
  }
  finally {
    state.settingsLoading = false
  }
}

const saveSettings = async () => {
  resetSettingsMessages()
  state.settingsLoading = true
  try {
    await edgeFirebase.runFunction('ebaySync-saveSettings', {
      uid: edgeFirebase.user.uid,
      orgId: edgeGlobal.edgeState.currentOrganization,
      siteId: props.site,
      settings: {
        enableSync: Boolean(state.settingsForm.enableSync),
        useWebhooks: Boolean(state.settingsForm.useWebhooks),
        inventoryMode: state.settingsForm.inventoryMode,
        syncIntervalMinutes: Number(state.settingsForm.syncIntervalMinutes || 2),
        ebayEnvironment: state.settingsForm.ebayEnvironment,
        appId: String(state.settingsForm.appId || '').trim(),
        devId: String(state.settingsForm.devId || '').trim(),
        certId: String(state.settingsForm.certId || '').trim(),
        ruName: String(state.settingsForm.ruName || '').trim(),
        refreshToken: String(state.settingsForm.refreshToken || '').trim(),
      },
    })
    state.settingsMessage = 'eBay sync settings saved.'
    await loadSettings()
  }
  catch (error) {
    state.settingsError = error?.message || 'Unable to save eBay sync settings.'
  }
  finally {
    state.settingsLoading = false
  }
}

const runSyncNow = async () => {
  resetSettingsMessages()
  state.settingsRunningSync = true
  try {
    await edgeFirebase.runFunction('ebaySync-runNow', {
      uid: edgeFirebase.user.uid,
      orgId: edgeGlobal.edgeState.currentOrganization,
      siteId: props.site,
      reason: 'manual',
    })
    state.settingsMessage = 'Sync job queued.'
  }
  catch (error) {
    state.settingsError = error?.message || 'Unable to queue sync job.'
  }
  finally {
    state.settingsRunningSync = false
  }
}

watch(() => route.query.tab, async () => {
  if (route.query.tab === 'settings') {
    state.tab = 'settings'
  }
})

watch(tagOptions, () => {
  refreshEditorSchema()
}, { deep: true })

onMounted(async () => {
  if (route.query.tab === 'settings') {
    state.tab = 'settings'
  }
  await loadSettings({ includeStatusMessage: false })
})
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <div v-if="!showSettings" class="flex-1 min-h-0">
      <edge-dashboard
        v-if="!docId"
        :collection="collection"
        :filter="state.filter"
        :filter-fields="['name', 'sku', 'status', 'tags', 'sites']"
        class="pt-0 h-full"
      >
        <template #header-start>
          <Box class="mr-2 h-4 w-4" />
          Products
        </template>
        <template #header-center>
          <div />
        </template>
        <template #header-end>
          <div class="flex items-center gap-2">
            <edge-shad-button
              variant="outline"
              @click="setTab('settings')"
            >
              <Settings class="mr-2 h-4 w-4" />
              eBay Settings
            </edge-shad-button>
            <edge-shad-button class="uppercase bg-slate-600" :to="`${productsBaseRoute}/new`">
              Add Product
            </edge-shad-button>
          </div>
        </template>

        <template #list="slotProps">
          <div class="w-full space-y-3">
            <div class="w-full mt-2 mx-0 rounded-md border border-slate-300/70 bg-slate-100/95 dark:border-slate-700 dark:bg-slate-900/95 px-3 py-2 space-y-2 backdrop-blur-sm shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <Checkbox
                    :model-value="getVisibleSelectionState(filterProducts(slotProps.filtered))"
                    aria-label="Select visible products"
                    class="border-slate-400 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-950 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
                    @click.stop
                    @update:model-value="toggleVisibleSelection(filterProducts(slotProps.filtered), $event)"
                  />
                  <span class="text-xs text-slate-600 dark:text-slate-300">
                    Select visible ({{ filterProducts(slotProps.filtered).length }})
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-slate-600 dark:text-slate-300">{{ selectedProductCount }} selected</span>
                  <edge-shad-button
                    variant="outline"
                    class="h-8 text-xs"
                    :disabled="selectedProductCount === 0"
                    @click="clearSelectedProducts"
                  >
                    Clear
                  </edge-shad-button>
                  <edge-shad-button
                    variant="destructive"
                    class="h-8 text-xs text-white"
                    :disabled="selectedProductCount === 0"
                    @click="deleteSelectedProducts"
                  >
                    Delete selected
                  </edge-shad-button>
                </div>
              </div>
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="md:flex-1 md:min-w-0">
                  <edge-shad-input
                    v-model="state.filter"
                    label=""
                    name="productFilter"
                    placeholder="Search products..."
                    class="w-full"
                  />
                </div>
                <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
                  <div class="md:min-w-[190px]">
                    <edge-shad-select-tags
                      v-model="state.productTagsFilter"
                      :items="tagOptions"
                      name="productTags"
                      placeholder="Filter tags"
                    />
                  </div>
                  <div class="md:min-w-[190px]">
                    <edge-shad-select-tags
                      v-model="state.productSitesFilter"
                      :items="siteFilterOptions"
                      name="productSites"
                      placeholder="Filter sites"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">
              <div class="grid grid-cols-12 gap-2 px-3 py-2 text-xs uppercase tracking-wide bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300">
                <div class="col-span-1" />
                <div class="col-span-3">Product</div>
                <div class="col-span-2">SKU</div>
                <div class="col-span-2">Price</div>
                <div class="col-span-1">Qty</div>
                <div class="col-span-1">Status</div>
                <div class="col-span-1">Sites</div>
                <div class="col-span-1 text-right">Actions</div>
              </div>

              <div
                v-for="item in filterProducts(slotProps.filtered)"
                :key="item.docId"
                class="grid grid-cols-12 gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-800 items-center"
              >
                <div class="col-span-1">
                  <Checkbox
                    :model-value="isProductSelected(item.docId)"
                    :aria-label="`Select product ${item.name || item.docId}`"
                    class="border-slate-400 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-950 data-[state=checked]:bg-slate-700 data-[state=checked]:text-white dark:data-[state=checked]:bg-slate-200 dark:data-[state=checked]:text-slate-900"
                    @click.stop
                    @update:model-value="setProductSelection(item.docId, $event)"
                  />
                </div>
                <div class="col-span-3 min-w-0">
                  <edge-shad-button
                    variant="link"
                    class="px-0 h-auto text-left text-sm font-semibold truncate"
                    :to="`${productsBaseRoute}/${item.docId}`"
                  >
                    {{ item.name || item.docId }}
                  </edge-shad-button>
                </div>
                <div class="col-span-2 text-sm text-muted-foreground truncate">{{ item.sku || 'N/A' }}</div>
                <div class="col-span-2 text-sm">${{ Number(item.price || 0).toFixed(2) }}</div>
                <div class="col-span-1 text-sm">{{ Number(item.quantity || 0) }}</div>
                <div class="col-span-1 text-sm capitalize">{{ item.status || 'draft' }}</div>
                <div class="col-span-1 text-xs truncate">{{ displaySiteValues(item.sites) }}</div>
                <div class="col-span-1 flex justify-end">
                  <edge-shad-button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8 text-slate-600 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-800"
                    @click.stop="slotProps.deleteItem(item.docId)"
                  >
                    <Trash class="h-4 w-4" />
                  </edge-shad-button>
                </div>
              </div>

              <div
                v-if="filterProducts(slotProps.filtered).length === 0"
                class="px-3 py-8 text-sm text-center text-muted-foreground border-t border-slate-200 dark:border-slate-800"
              >
                No products match the current filters.
              </div>
            </div>
          </div>
        </template>
      </edge-dashboard>

      <edge-editor
        v-else
        :collection="collection"
        :doc-id="docId"
        :schema="productSchema"
        :new-doc-schema="state.newDocSchema"
        class="w-full max-w-7xl mx-auto flex-1 pt-0 px-0"
      >
        <template #header-start="slotProps">
          <FilePenLine class="mr-2" />
          {{ slotProps.title }}
        </template>
        <template #header-end="slotProps">
          <edge-shad-button
            v-if="!slotProps.unsavedChanges"
            :to="productsBaseRoute"
            class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
          >
            Close
          </edge-shad-button>
          <edge-shad-button
            v-else
            :to="productsBaseRoute"
            class="bg-red-700 uppercase h-8 hover:bg-slate-400 w-20"
          >
            Cancel
          </edge-shad-button>
          <edge-shad-button
            type="submit"
            class="bg-slate-500 uppercase h-8 hover:bg-slate-400 w-20"
          >
            Save
          </edge-shad-button>
        </template>
      </edge-editor>
    </div>

    <div v-else class="flex-1 min-h-0 p-4 overflow-y-auto">
      <Card class="border border-slate-300 dark:border-slate-700">
        <CardHeader>
          <div class="flex items-center justify-between gap-2">
            <div>
              <CardTitle>eBay Sync Settings</CardTitle>
              <CardDescription>Configure site-level product sync between Edge CMS and eBay.</CardDescription>
            </div>
            <div class="flex items-center gap-2">
              <edge-shad-button
                type="button"
                variant="outline"
                :disabled="state.settingsRunningSync"
                @click="runSyncNow"
              >
                <Loader2 v-if="state.settingsRunningSync" class="h-4 w-4 mr-2 animate-spin" />
                <RefreshCw v-else class="h-4 w-4 mr-2" />
                Sync Now
              </edge-shad-button>
              <edge-shad-button type="button" variant="outline" @click="state.tab = 'products'">
                Back to Products
              </edge-shad-button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <edge-shad-form :schema="settingsSchema" @submit="saveSettings">
            <div class="grid grid-cols-12 gap-3">
              <div class="col-span-12 md:col-span-6">
                <edge-g-input v-model="state.settingsForm.enableSync" name="enableSync" field-type="boolean" label="Enable eBay Sync" />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input v-model="state.settingsForm.useWebhooks" name="useWebhooks" field-type="boolean" label="Use eBay Webhooks" />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input
                  v-model="state.settingsForm.inventoryMode"
                  name="inventoryMode"
                  field-type="select"
                  label="Inventory Conflict Mode"
                  :items="['safety-first', 'ebay-wins', 'site-wins']"
                />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input
                  v-model="state.settingsForm.syncIntervalMinutes"
                  name="syncIntervalMinutes"
                  field-type="integer"
                  label="Reconciliation Interval (minutes)"
                />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input
                  v-model="state.settingsForm.ebayEnvironment"
                  name="ebayEnvironment"
                  field-type="select"
                  label="Environment"
                  :items="['production', 'sandbox']"
                />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input v-model="state.settingsForm.appId" name="appId" field-type="text" label="eBay App ID" />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input v-model="state.settingsForm.devId" name="devId" field-type="text" label="eBay Dev ID" />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input v-model="state.settingsForm.certId" name="certId" field-type="text" label="eBay Cert ID" />
              </div>
              <div class="col-span-12 md:col-span-6">
                <edge-g-input v-model="state.settingsForm.ruName" name="ruName" field-type="text" label="RU Name" />
              </div>
              <div class="col-span-12">
                <edge-g-input
                  v-model="state.settingsForm.refreshToken"
                  name="refreshToken"
                  field-type="textarea"
                  label="Refresh Token"
                  :hint="state.settingsForm.refreshTokenMasked ? `Current token: ${state.settingsForm.refreshTokenMasked}` : ''"
                  persistent-hint
                />
              </div>
            </div>

            <div class="flex justify-end mt-4">
              <edge-shad-button type="submit" :disabled="state.settingsLoading" class="bg-slate-700 text-white hover:bg-slate-800">
                <Loader2 v-if="state.settingsLoading" class="w-4 h-4 mr-2 animate-spin" />
                Save Settings
              </edge-shad-button>
            </div>
          </edge-shad-form>
        </CardContent>
      </Card>

      <Alert v-if="state.settingsMessage" class="mt-4 border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>{{ state.settingsMessage }}</AlertDescription>
      </Alert>

      <Alert v-if="state.settingsError" variant="destructive" class="mt-4">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{{ state.settingsError }}</AlertDescription>
      </Alert>
    </div>
  </div>
</template>
