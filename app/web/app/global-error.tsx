"use client";

import { useEffect, useState } from "react";
import { ErrorState } from "../components/layout/error-state";
import { I18nProvider } from "../components/layout/i18n-provider";
import { createTraceId, reportClientError } from "../lib/observability";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	const [traceId] = useState(createTraceId);

	useEffect(() => {
		reportClientError(error, traceId, "web.global");
	}, [error, traceId]);

	return <html lang="en"><body><I18nProvider initialLocale="en" detectClientLocale><ErrorState traceId={traceId} onRetry={reset} /></I18nProvider></body></html>;
}
