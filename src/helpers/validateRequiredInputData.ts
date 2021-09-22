import { parseSchemaType, Schema, Type } from "gqless"
import { isPlainObject, isScalar } from "./utils"

type ValidationContext = {
  validationErrors: ValidationErrors
  requiredErrorMessage: string
}

export type ValidationErrors = {
  [index: string]: string
}

function appendFieldPath(current: string | null | undefined, fieldPath: string | number) {
  if (current == null || current === "") {
    return `${fieldPath}`
  } else {
    return `${current}.${fieldPath}`
  }
}

function validateValue(
  value: any,
  fieldPath: string,
  typeName: string,
  schema: Schema,
  context: ValidationContext
): void {
  const { pureType, isArray, isNullable, nullableItems } = parseSchemaType(typeName)

  // If required and value is nullish, then add error
  if (!isNullable && value == null) {
    context.validationErrors[fieldPath] = context.requiredErrorMessage
    return
  }

  // If array and required items, check that every item is not nullish
  if (isArray && !nullableItems) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item == null) {
          context.validationErrors[appendFieldPath(fieldPath, index)] =
            context.requiredErrorMessage
        }
      })
    }
  }

  // If array, continue to validate each item
  if (isArray) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        validateValue(item, appendFieldPath(fieldPath, index), pureType, schema, context)
      })
    }
  } else if (!isScalar(pureType)) {
    // If not a scalar, continue to validate each field.

    // Take the schema definition
    const typeObject = schema[pureType]

    // Type object is not found, maybe it's an enum.
    // In any case, don't go further.
    if (!typeObject) {
      return
    }

    // Skip value if it is not an object
    if (!isPlainObject(value)) {
      return
    }

    // Validate each field of the type.
    for (const key in typeObject) {
      const type = typeObject[key]
      const fieldValue = value[key]
      validateValue(
        fieldValue,
        appendFieldPath(fieldPath, key),
        type.__type,
        schema,
        context
      )
    }
  }
}

export function validateRequiredInputData(
  data: any,
  operationType: Type,
  schema: Schema,
  requiredErrorMessage: string
): ValidationErrors | undefined {
  const context: ValidationContext = {
    validationErrors: {},
    requiredErrorMessage,
  }

  // An object is expected, otherwise leave it as it is
  if (!isPlainObject(data)) {
    return undefined
  }

  const args = operationType.__args

  // Validate every arg
  for (const key in args) {
    const value = data[key]
    const argTypeName = args[key]

    // We pass an empty string as fieldPath, because we want to have
    // `fieldPath` without the argument name in order to make it work with our form.
    // I know, it's ugly as hell...
    validateValue(value, "", argTypeName, schema, context)
  }

  if (Object.keys(context.validationErrors).length > 0) {
    return context.validationErrors
  } else {
    return undefined
  }
}
