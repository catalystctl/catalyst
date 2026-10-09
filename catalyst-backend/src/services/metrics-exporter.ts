import { Registry, Counter, Histogram, Gauge } from "prom-client";
import type { FastifyInstance } from "fastify";

export class MetricsExporter {
	readonly registry: Registry;
	private readonly httpRequestDuration: Histogram<string>;
	private readonly httpRequestTotal: Counter<string>;
	private readonly wsConnectionsActive: Gauge<string>;
	private readonly dbConnectionPoolSize: Gauge<string>;

	constructor() {
		this.registry = new Registry();

		this.httpRequestDuration = new Histogram({
			name: "http_request_duration_seconds",
			help: "HTTP request duration in seconds",
			labelNames: ["method", "route", "status_code"],
			buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
			registers: [this.registry],
		});

		this.httpRequestTotal = new Counter({
			name: "http_requests_total",
			help: "Total HTTP requests",
			labelNames: ["method", "route", "status_code"],
			registers: [this.registry],
		});

		this.wsConnectionsActive = new Gauge({
			name: "websocket_connections_active",
			help: "Number of active WebSocket connections",
			registers: [this.registry],
		});

		this.dbConnectionPoolSize = new Gauge({
			name: "db_connection_pool_size",
			help: "Database connection pool size by state",
			labelNames: ["state"],
			registers: [this.registry],
		});
	}

	recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
		const labels = {
			method,
			route: this.normalizeRoute(route),
			status_code: String(statusCode),
		};
		this.httpRequestDuration.observe(labels, durationSeconds);
		this.httpRequestTotal.inc(labels);
	}

	setActiveWebSocketConnections(count: number): void {
		this.wsConnectionsActive.set(count);
	}

	setDbConnectionPoolSize(idle: number, active: number): void {
		this.dbConnectionPoolSize.set({ state: "idle" }, idle);
		this.dbConnectionPoolSize.set({ state: "active" }, active);
	}

	private normalizeRoute(url: string): string {
		// Strip query params and normalize IDs to reduce cardinality
		const path = url.split("?")[0];
		return path
			.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
			.replace(/\/\d+/g, "/:id");
	}

	async getMetrics(): Promise<string> {
		return this.registry.metrics();
	}
}

let metricsExporter: MetricsExporter | undefined;

export function initializeMetrics(): MetricsExporter {
	if (!metricsExporter) {
		metricsExporter = new MetricsExporter();
	}
	return metricsExporter;
}

export function getMetrics(): MetricsExporter | undefined {
	return metricsExporter;
}

export function registerMetricsEndpoint(app: FastifyInstance): void {
	app.get("/metrics", { logLevel: "warn" }, async (_request, reply) => {
		const exporter = getMetrics();
		if (!exporter) {
			reply.status(503).send({ error: "Metrics not initialized" });
			return;
		}
		const metrics = await exporter.getMetrics();
		reply.type("text/plain; version=0.0.4; charset=utf-8").send(metrics);
	});
}
