import { GQlessClient } from "gqless"

type RequestFunc<T> = () => T

type RequestEntry<T> = {
  func: RequestFunc<T>
  resolve: (value: T) => void
  reject: (reason?: any) => void
}

export type QueryBatcherConfig = {
  gqlessClient: GQlessClient<any>
  queryBatchTimeMS: number
}

export function createQueryBatcher(config: QueryBatcherConfig) {
  const { gqlessClient, queryBatchTimeMS } = config

  let requests: RequestEntry<any>[] = []
  let hTimeout: any = null

  function request<T>(func: RequestFunc<T>) {
    return new Promise<T>((resolve, reject) => {
      requests.push({
        func,
        resolve,
        reject,
      })

      if (hTimeout === null) {
        startTimeout()
      }
    })
  }

  function startTimeout() {
    hTimeout = setTimeout(() => {
      hTimeout = null
      runRequests()
    }, queryBatchTimeMS)
  }

  async function runRequests() {
    const reqs = [...requests]
    requests = []

    try {
      const results = await gqlessClient.resolved(
        () => {
          return reqs.map((req) => req.func())
        },
        {
          noCache: true,
          retry: false,
        }
      )

      // Resolve each request with its own result
      results.forEach((res, i) => {
        reqs[i].resolve(res)
      })
    } catch (err) {
      // In case of error, if there is only 1 request, we call its reject callback.
      if (reqs.length === 1) {
        reqs[0].reject(err)
      } else {
        // In case of multiple queries, we cannot distinguish which query succedeed or failed,
        // so we retry all of them, one by one, without batching.
        await Promise.all(
          reqs.map(async (req) => {
            try {
              const result = await gqlessClient.resolved(req.func, {
                noCache: true,
                retry: false,
              })
              req.resolve(result)
            } catch (reqErr) {
              req.reject(reqErr)
            }
          })
        )
      }
    }
  }

  return {
    request,
  }
}
