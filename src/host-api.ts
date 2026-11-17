/** Check only the methods used by this plugin; extra host APIs are welcome. */
export function assertHostMethods(plugin: string, host: unknown, methods: readonly string[]): void {
  const missingMethods = methods.filter(path => {
    let value: unknown = host
    for (const key of path.split('.')) {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return true
      value = Reflect.get(value, key)
    }
    return typeof value !== 'function'
  })
  if (missingMethods.length) {
    throw Object.assign(new Error(`[${plugin}] 当前 DSH 缺少必需接口：${missingMethods.join('、')}。请升级插件以适配当前 DSH。`), {
      code: 'DSH_API_UNSUPPORTED', missingMethods,
    })
  }
}

/** Optional contributions must not take down the host or the plugin's other features. */
export function hostMethodsAvailable(plugin: string, host: unknown, methods: readonly string[]): boolean {
  try { assertHostMethods(plugin, host, methods); return true }
  catch (error) { console.warn(error instanceof Error ? error.message : error); return false }
}
