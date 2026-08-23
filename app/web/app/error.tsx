"use client";

import { useEffect, useState } from "react";
import { ErrorState } from "../components/error-state";
import { createTraceId, reportClientError } from "../lib/observability";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	const [traceId] = useState(createTraceId);

	useEffect(() => {
		reportClientError(error, traceId, "web.route");
	}, [error, traceId]);

	return <ErrorState traceId={traceId} onRetry={reset} />;
}
