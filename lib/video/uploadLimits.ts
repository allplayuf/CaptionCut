// Short-form editing must leave enough server scratch space for analysis,
// transcription and export. A 500 MB ceiling also keeps a public beta from
// turning one accidental phone upload into an unbounded storage bill.
export const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_LABEL = "500 MB";
