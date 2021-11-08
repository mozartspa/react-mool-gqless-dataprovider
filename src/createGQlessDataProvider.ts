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
import { dset } from "dset"
import { GQlessClient, GQlessError, Schema, selectFields } from "gqless"
import { RecordNotFoundError } from "./helpers/errors"
import { fixInputData } from "./helpers/fixInputData"
import { createQueryBatcher } from "./helpers/queryBatcher"

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

export type GQlessRecordOuput<TRecord = any, TOutput = any> = (record: TRecord) => TOutput

export type GQlessException = {
  operations?: GQlessOperations
  getRecordId?: GQlessGetRecordId
  overrideMethods?: GQlessOverrideMethods
  selectFieldsDepth?: number
  recordOutput?: GQlessRecordOuput
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
  queryBatchTimeMS?: number
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

function buildOrderBy(
  sortField: GetListParams["sortField"],
  sortOrder: GetListParams["sortOrder"]
) {
  if (sortField) {
    let orderBy = {}
    dset(orderBy, sortField, sortOrder)
    return [orderBy]
  } else {
    return undefined
  }
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
    queryBatchTimeMS = 50,
    handleError,
  } = config

  // Check autofix can be enabled
  if (autofixInputData && !gqlessSchema) {
    throw new Error(
      `"autofixInputData" can be enabled only if "gqlessSchema" is provided.`
    )
  }

  const batcher = createQueryBatcher({
    gqlessClient,
    queryBatchTimeMS,
  })

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

    const input = buildInput()

    const request = () => {
      const result = func(input)
      const output = operation.output(resource, result, funcName)
      return output
    }

    // Batch only requests that are queries.
    const shouldBatch = kind === "query" && queryBatchTimeMS > 0

    if (shouldBatch) {
      return batcher.request(request)
    } else {
      return gqlessClient.resolved(request, {
        noCache: true,
        retry: false,
      })
    }
  }

  const getSelectFieldsDepth = (resource: string) => {
    return exceptions[resource]?.selectFieldsDepth ?? selectFieldsDepth
  }

  const getRecordOuput = (resource: string, result: any) => {
    const recordOutput = exceptions[resource]?.recordOutput
    if (result == null) {
      return result
    } else if (recordOutput) {
      return recordOutput(result)
    } else {
      return selectFields(result, "*", getSelectFieldsDepth(resource))
    }
  }

  const getOneOperation: Required<GQlessOperations["getOne"]> = {
    name: (resource) => `${resource}`,
    input: (_, params) => params,
    output: (resource, result) => {
      return getRecordOuput(resource, result)
    },
  }

  const getListOperation: Required<GQlessOperations["getList"]> = {
    name: (resource) => `${resource}List`,
    input: (_, params) => {
      return {
        where: params.filter,
        skip: params.pageSize * (params.page - 1),
        take: params.pageSize,
        orderBy: buildOrderBy(params.sortField, params.sortOrder),
      }
    },
    output: (resource, result) => {
      return {
        items: result?.items?.map((item: any) => getRecordOuput(resource, item)) || [],
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
      return getRecordOuput(resource, result)
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
      return getRecordOuput(resource, result)
    },
  }

  const deleteOperation: Required<GQlessOperations["delete"]> = {
    name: (resource) => `${resource}Delete`,
    input: (_, params) => params,
    output: (resource, result) => {
      return getRecordOuput(resource, result)
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

    const record = await runOperation("query", op, resource, params)

    // If record is null then throws an error
    if (record == null) {
      throw new RecordNotFoundError(params.id, resource)
    }

    return record
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
