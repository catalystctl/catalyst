import { describe, it, expect } from "vitest";
import { MetricsExporter } from "../services/metrics-exporter";

describe("MetricsExporter", () => {
	it("exposes every registered metric in the Prometheus text format", async () => {
		const exporter = new MetricsExporter();

		exporter.recordHttpRequest("GET", "/api/servers/123", 200, 0.42);
		exporter.setActiveWebSocketConnections(3);
		exporter.setDbConnectionPoolSize(4, 5);

		const output = await exporter.getMetrics();

		// Histogram + counter share the request path.
		expect(output).toContain("# TYPE http_request_duration_seconds histogram");
		expect(output).toContain("http_request_duration_seconds_sum");
		expect(output).toContain("# TYPE http_requests_total counter");
		expect(output).toContain("http_requests_total{method=\"GET\",route=\"/api/servers/:id\",status_code=\"200\"} 1");
		expect(output).toContain("websocket_connections_active 3");
		expect(output).toContain("db_connection_pool_size{state=\"idle\"} 4");
		expect(output).toContain("db_connection_pool_size{state=\"active\"} 5");
	});

	it("normalizes dynamic id segments so route labels stay low-cardinality", async () => {
		const exporter = new MetricsExporter();

		exporter.recordHttpRequest("POST", "/api/servers/42/backups", 201, 0.1);
		exporter.recordHttpRequest(
			"DELETE",
			"/api/servers/3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8?force=1",
			204,
			0.2,
		);

		const output = await exporter.getMetrics();

		expect(output).toContain('route="/api/servers/:id/backups"');
		expect(output).toContain('route="/api/servers/:id"');
		// Query strings must never leak into a label.
		expect(output).not.toContain("force=1");
	});
});