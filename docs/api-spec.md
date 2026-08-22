# Manifold API Specification

Base URL: /api/v1

所有错误统一返回 `{ error: { code, message, details? } }`。列表接口返回 `{ data, meta }`。

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /healthz | Liveness check |
| GET | /api/v1/profile | Public profile |
| GET | /api/v1/entries | Published entries |
| GET | /api/v1/now | Current status beacon |
