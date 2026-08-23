"use client";

import { useEffect, useState } from "react";
import { ErrorState } from "../components/error-state";
import { createTraceId, reportClientError } from "../lib/observability";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	const [traceId] = useState(createTraceId);

	useEffect(() => {
		reportClientError(error, traceId, "web.global");
	}, [error, traceId]);

	return <html lang="en"><body><ErrorState traceId={traceId} onRetry={reset} /></body></html>;
}
