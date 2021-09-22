export function isPlainObject(value: any) {
  return value != null && !Array.isArray(value)
}

const scalars = ["Int", "Float", "String", "Boolean", "ID"]

export function isScalar(typeName: string) {
  return scalars.includes(typeName)
}
