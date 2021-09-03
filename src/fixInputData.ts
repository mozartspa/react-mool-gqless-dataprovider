import { parseSchemaType, Schema, Type } from "gqless"

function isPlainObject(value: any) {
  return value != null && !Array.isArray(value)
}

const scalars = ["Int", "Float", "String", "Boolean", "ID"]

function isScalar(typeName: string) {
  return scalars.includes(typeName)
}

function fixScalar(value: any, typeName: string) {
  switch (typeName) {
    case "Int": {
      return typeof value === "number" && Number.isInteger(value)
        ? value
        : Math.round(Number(value))
    }
    case "Float": {
      return typeof value === "number" ? value : Number(value)
    }
    case "String":
    case "ID": {
      return typeof value === "string" ? value : String(value)
    }
    case "Boolean": {
      return typeof value === "boolean" ? value : Boolean(value)
    }
  }

  return value
}

function fixValue(value: any, typeName: string, schema: Schema): any {
  if (value == null) {
    return value
  }

  const { pureType, isArray } = parseSchemaType(typeName)

  if (isArray) {
    // Skip value if it is not an array
    if (!Array.isArray(value)) {
      return undefined
    }

    // Fix every item of array
    return value.map((item) => fixValue(item, pureType, schema))
  } else if (isScalar(pureType)) {
    return fixScalar(value, pureType)
  } else {
    // Take the schema definition
    const typeObject = schema[pureType]

    // Type object is not found, maybe it's an enum.
    // In any case, leave the value as it is.
    if (!typeObject) {
      return value
    }

    // Skip value if it is not an object
    if (!isPlainObject(value)) {
      return undefined
    }

    let result = {} as any

    // Fix every field
    for (const key in value) {
      // Take expected type of field
      const type = typeObject[key]

      // Consider only fields that have a type
      if (type) {
        result[key] = fixValue(value[key], type.__type, schema)
      }
    }

    return result
  }
}

export function fixInputData(data: any, operationType: Type, schema: Schema) {
  // An object is expected, otherwise leave it as it is
  if (!isPlainObject(data)) {
    return data
  }

  let result = {} as any
  const args = operationType.__args

  // Fix every field
  for (const key in data) {
    const value = data[key]
    const argTypeName = args?.[key]

    // Consider only fields that have a corresponding arg type
    if (argTypeName) {
      result[key] = fixValue(value, argTypeName, schema)
    }
  }

  return result
}
