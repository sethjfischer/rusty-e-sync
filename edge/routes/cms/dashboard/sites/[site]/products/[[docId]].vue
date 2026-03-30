<script setup>
const route = useRoute()

const site = computed(() => {
  if (route.params?.site) {
    return route.params.site
  }
  return ''
})

definePageMeta({
  middleware: 'auth',
})
</script>

<template>
  <div v-if="edgeGlobal.edgeState.organizationDocPath">
    <edge-cms-products :site="site" />
  </div>
</template>
