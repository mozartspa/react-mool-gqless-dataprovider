import {
  DataProvider,
  DeleteParams,
  GetListOutput,
  GetListParams,
  GetOneParams,
  RecordID,
  UnauthorizedError,
  UpdateParams,
  ValidationError,
} from "@react-mool/core"
import { GQlessClient, GQlessError, Schema, selectFields } from "gqless"
import { fixInputData } from "./fixInputData"

export type GQlessOperationConfig<TInput = any, TOutput = any> = {
  name?: (resource: string) => string
  input?: (resource: string, params: TInput, operationName: string) => any
  output?: (resource: string, result: any, operationName: string) => TOutput
}

export type GQlessOperations = {
  getOne?: GQlessOperationConfig<GetOneParams, any>
  getList?: GQlessOperationConfig<GetListParams, GetListOutput>
  create?: GQlessOperationConfig<any, any>
  update?: GQlessOperationConfig<UpdateParams, any>
  delete?: GQlessOperationConfig<DeleteParams, any>
}

export type GQlessGetRecordId = (resource: string, record: any) => RecordID

export type GQlessOverrideMethods = Partial<Omit<DataProvider, "id">>

export type GQlessException = {
  operations?: GQlessOperations
  getRecordId?: GQlessGetRecordId
  overrideMethods?: GQlessOverrideMethods
  selectFieldsDepth?: number
}

export type GQlessDataProviderConfig = {
  gqlessClient: GQlessClient<any>
  gqlessSchema?: Schema
  getRecordId?: GQlessGetRecordId
  operations?: GQlessOperations
  exceptions?: Record<string, GQlessException | undefined>
  overrideMethods?: GQlessOverrideMethods
  selectFieldsDepth?: number
  autofixInputData?: boolean
  handleError?: (error: any, defaultHandler: () => never) => never
}

function mergeOperations<T extends { name?: any; input?: any; output?: any }>(
  op1: T | undefined,
  op2: T | undefined,
  op3: Required<T>
): {
  name: NonNullable<T["name"]>
  input: NonNullable<T["input"]>
  output: NonNullable<T["output"]>
} {
  return {
    name: op1?.name || op2?.name || op3.name,
    input: op1?.input || op2?.input || op3.input,
    output: op1?.output || op2?.output || op3.output,
  }
}

function defaultErrorHandler(error: any): never {
  if (error instanceof GQlessError) {
    if (error.graphQLErrors && error.graphQLErrors.length > 0) {
      const firstError = error.graphQLErrors[0]
      const extensions = firstError.extensions || {}
      const _code = extensions.code

      switch (_code) {
        case "BAD_USER_INPUT":
          if (extensions.validationErrors) {
            throw new ValidationError(extensions.validationErrors, firstError.message)
          }
          break

        case "UNAUTHENTICATED":
        case "FORBIDDEN":
          throw new UnauthorizedError(firstError.message)
      }
    }
  }

  throw error
}

export function createGQlessDataProvider(config: GQlessDataProviderConfig) {
  const {
    gqlessClient,
    gqlessSchema,
    getRecordId,
    operations,
    exceptions = {},
    overrideMethods = {},
    selectFieldsDepth = 1,
    autofixInputData = gqlessSchema ? true : false,
    handleError,
  } = config

  // Check autofix can be enabled
  if (autofixInputData && !gqlessSchema) {
    throw new Error(
      `"autofixInputData" can be enabled only if "gqlessSchema" is provided.`
    )
  }

  function withErrorHandler<TInput extends Array<any>, TOutput>(
    func: (...input: TInput) => Promise<TOutput>
  ) {
    return async (...input: TInput) => {
      try {
        return await func(...input)
      } catch (error) {
        // Default handler
        const defaultHandler = () => {
          defaultErrorHandler(error)
        }

        if (handleError) {
          handleError(error, defaultHandler)
        } else {
          defaultHandler()
        }

        // Be sure that an error is thrown
        throw error
      }
    }
  }

  function runOperation<TInput, TOutput>(
    kind: "query" | "mutation",
    operation: Required<GQlessOperationConfig<TInput, TOutput>>,
    resource: string,
    params: TInput
  ) {
    const funcName = operation.name(resource)
    const func = gqlessClient[kind][funcName]

    if (!(func instanceof Function)) {
      throw new Error(
        `"${funcName}" is not a valid ${kind} name available on the gqless client provided.`
      )
    }

    const buildInput = () => {
      const input = operation.input(resource, params, funcName)

      if (autofixInputData && gqlessSchema) {
        const type = gqlessSchema[kind][funcName]
        return fixInputData(input, type, gqlessSchema)
      } else {
        return input
      }
    }

    return gqlessClient.resolved(
      () => {
        const input = buildInput()
        const result = func(input)
        const output = operation.output(resource, result, funcName)
        return output
      },
      {
        noCache: true,
        retry: false,
      }
    )
  }

  const getSelectFieldsDepth = (resource: string) => {
    return exceptions[resource]?.selectFieldsDepth ?? selectFieldsDepth
  }

  const getOneOperation: Required<GQlessOperations["getOne"]> = {
    name: (resource) => `${resource}`,
    input: (_, params) => params,
    output: (resource, result) => {
      return selectFields(result, "*", getSelectFieldsDepth(resource))
    },
  }

  const getListOperation: Required<GQlessOperations["getList"]> = {
    name: (resource) => `${resource}List`,
    input: (_, params) => {
      return {
        where: params.filter,
        skip: params.pageSize * (params.page - 1),
        take: params.pageSize,
        orderBy: params.sortField
          ? [{ [params.sortField]: params.sortOrder }]
          : undefined,
      }
    },
    output: (resource, result) => {
      return {
        items: selectFields(result?.items, "*", getSelectFieldsDepth(resource)) || [],
        total: result?.total || 0,
      }
    },
  }

  const createOperation: Required<GQlessOperations["create"]> = {
    name: (resource) => `${resource}Create`,
    input: (_, params) => {
      return {
        data: params,
      }
    },
    output: (resource, result) => {
      return selectFields(result, "*", getSelectFieldsDepth(resource))
    },
  }

  const updateOperation: Required<GQlessOperations["update"]> = {
    name: (resource) => `${resource}Update`,
    input: (_, params) => {
      return {
        data: {
          ...params.data,
          id: params.id,
        },
      }
    },
    output: (resource, result) => {
      return selectFields(result, "*", getSelectFieldsDepth(resource))
    },
  }

  const deleteOperation: Required<GQlessOperations["delete"]> = {
    name: (resource) => `${resource}Delete`,
    input: (_, params) => params,
    output: (resource, result) => {
      return selectFields(result, "*", getSelectFieldsDepth(resource))
    },
  }

  const defaultGetRecordId: GQlessGetRecordId = (_, record) => {
    return record?.id
  }

  const defaultGetOne: DataProvider["getOne"] = async (resource, params) => {
    const op = mergeOperations(
      exceptions[resource]?.operations?.getOne,
      operations?.getOne,
      getOneOperation
    )
    return runOperation("query", op, resource, params)
  }

  const defaultGetList: DataProvider["getList"] = async (resource, params) => {
    const op = mergeOperations(
      exceptions[resource]?.operations?.getList,
      operations?.getList,
      getListOperation
    )
    return runOperation("query", op, resource, params)
  }

  const defaultCreate: DataProvider["create"] = async (resource, params) => {
    const op = mergeOperations(
      exceptions[resource]?.operations?.create,
      operations?.create,
      createOperation
    )
    return runOperation("mutation", op, resource, params)
  }

  const defaultUpdate: DataProvider["update"] = async (resource, params) => {
    const op = mergeOperations(
      exceptions[resource]?.operations?.update,
      operations?.update,
      updateOperation
    )
    return runOperation("mutation", op, resource, params)
  }

  const defaultDelete: DataProvider["delete"] = async (resource, params) => {
    const op = mergeOperations(
      exceptions[resource]?.operations?.delete,
      operations?.delete,
      deleteOperation
    )
    return runOperation("mutation", op, resource, params)
  }

  const dataProvider: DataProvider = {
    id: (resource, record) => {
      const func = exceptions[resource]?.getRecordId || getRecordId || defaultGetRecordId
      return func(resource, record)
    },

    getOne: (resource, params) => {
      const func =
        exceptions[resource]?.overrideMethods?.getOne ||
        overrideMethods.getOne ||
        defaultGetOne

      return withErrorHandler(func)(resource, params)
    },

    getList: async (resource, params) => {
      const func =
        exceptions[resource]?.overrideMethods?.getList ||
        overrideMethods.getList ||
        defaultGetList

      return withErrorHandler(func)(resource, params)
    },

    create: async (resource, params) => {
      const func =
        exceptions[resource]?.overrideMethods?.create ||
        overrideMethods.create ||
        defaultCreate

      return withErrorHandler(func)(resource, params)
    },

    update: async (resource, params) => {
      const func =
        exceptions[resource]?.overrideMethods?.update ||
        overrideMethods.update ||
        defaultUpdate

      return withErrorHandler(func)(resource, params)
    },

    delete: async (resource, params) => {
      const func =
        exceptions[resource]?.overrideMethods?.delete ||
        overrideMethods.delete ||
        defaultDelete

      return withErrorHandler(func)(resource, params)
    },
  }

  return dataProvider
}
