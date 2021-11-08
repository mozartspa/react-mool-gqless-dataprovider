import { RecordID } from "@react-mool/core"

export class RecordNotFoundError extends Error {
  constructor(
    public recordId: RecordID,
    public resource: string,
    message = "Not found error"
  ) {
    super(message)
    // HACK: https://github.com/Microsoft/TypeScript/wiki/FAQ#why-doesnt-extending-built-ins-like-error-array-and-map-work
    Object.setPrototypeOf(this, RecordNotFoundError.prototype)
  }
}
