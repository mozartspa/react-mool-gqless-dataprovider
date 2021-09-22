# @mozartspa/react-mool-gqless-dataprovider

A GraphQL data provider for [react-mool](https://github.com/mozartspa/react-mool/) built with [GQless](https://gqless.com/).

## Installation

**NOTE**: you should have already installed [gqless](https://gqless.com/) and [generated](https://gqless.com/getting-started) the gqless schema.

```bash
yarn add @mozartspa/react-mool-gqless-dataprovider
```

## Usage

```typescript
// import the generated gqless client and schema
import { client, generatedSchema } from "./gqless"
// import this lib
import { createGQlessDataProvider } from "@mozartspa/react-mool-gqless-dataprovider"

export const dataProvider = createGQlessDataProvider({
  gqlessClient: client,
  gqlessSchema: generatedSchema,
})
```

If the default settings don't suit you, you can customize the behavior:

- per **operation** (`getOne`, `getList`, `create`, `update` and `delete`)
- per **resource**
- or completely override one of the methods

```typescript
export const dataProvider = createGQlessDataProvider({
  gqlessClient: client,
  gqlessSchema: generatedSchema,

  // Customize how to extract the ID from the record
  getRecordId: (resource, record) => record.id,

  /*
    Per each operation, you can define:
    - name: which query/mutation should be called
    - input: how to convert the input params to suit your query/mutation expected inputs
    - output: how to extract the data from the result returned by your query/mutation
  */
  operations: {
    // Here we define the behavior of `getOne` operation.
    // If you don't specify one of `name`, `input` or `output`, the default will be used.
    getOne: {
      name: (resource) => `${resource}`,
      input: (resource, params) => {
        return {
          id: Number(params.id),
        }
      },
      output: (resource, result) => {
        return selectFields(result, "*", 2)
      },
    },

    // It's not required to define every operation, just do it for the operation you want
    getList: {
      /* ... */
    },
    create: {
      /* ... */
    },
    update: {
      /* ... */
    },
    delete: {
      /* ... */
    },
  },

  /*
   Customize the behavior per resource
  */
  exceptions: {
    // `article` is the name of our sample resource
    article: {
      /*
       Define the operations you want to override
      */
      operations: {
        getList: {
          name: () => "articles",
          input: (resource, params) => {
            return {
              ...params,
              where: params.filter,
            }
          },
          output: (resource, result) => {
            return {
              items: selectFields(result?.articles, "*", 2) || [],
              total: result?.count || 0,
            }
          },
        },
      },

      /*
       If you want to completely override a method for this resource
       and implement it yourself then do it in `overrideMethods`.
      */
      overrideMethods: {
        /* override single methods of resource `article` */
      },
    },
  },

  /*
   If you want to completely override a method for all the resources
   and implement it yourself then do it in `overrideMethods`.
  */
  overrideMethods: {
    getOne: /* ... */,
    getList: /* ... */,
    create: /* ... */,
    update: /* ... */,
    delete: /* ... */,
  },

  /*
    The depth value used in the `selectFields` method
  */
  selectFieldsDepth: 2, // default: 1

  /*
    If `true`, the input data passed to the gqless client is checked against the gqless schema provided:
    - unexpected fields are removed.
    - wrong scalar value types are converted accordingly (string -> number and viceversa).
  */
  autofixInputData: false, // default: true

  /*
   Which error should be thrown in case of failure.
   `defaultHandler` can be called to handle the error in the default way.
  */
  handleError: (error, defaultHandler) => {
    if (error instanceof GQlessError) {
      /* ... */
    } else {
      return defaultHandler()
    }
  },
})
```
