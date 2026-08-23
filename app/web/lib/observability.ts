import { createTraceId } from "@manifold/sdk";

export function reportClientError(error: unknown, traceId: string, scope: string) {
	const details = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
	console.error("manifold.client_error", { scope, traceId, error: details });
}

export { createTraceId };
