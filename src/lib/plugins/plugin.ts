

export interface Plugin<S, A> {
  syncIface: S
  asyncIface: A
  isAsync: boolean
}
