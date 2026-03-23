const randomToken = () => Math.random().toString(36).slice(2, 10);

export const createId = (prefix: string) =>
  `${prefix}_${randomToken()}${randomToken()}`;

export const createResponseId = () => createId('resp');
export const createMessageId = () => createId('msg');
export const createFunctionCallId = () => createId('fc');
export const createCallId = () => createId('call');
export const createReasoningId = () => createId('rs');
