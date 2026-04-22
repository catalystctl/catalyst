import { describe, it, expect } from "vitest";
import { sanitizeStartupCommand } from "../utils/sanitize-startup";

describe("sanitizeStartupCommand", () => {
	it("fixes {{ENS_PID}} when ENS_PID=$! is assigned", () => {
		const input =
			"rm ./logs/enshrouded_server.log; proton run ./enshrouded_server.exe & ENS_PID=$! ; tail -c0 -F ./logs/enshrouded_server.log --pid={{ENS_PID}}";
		const output = sanitizeStartupCommand(input);
		expect(output).toBe(
			"rm ./logs/enshrouded_server.log; proton run ./enshrouded_server.exe & ENS_PID=$! ; tail -c0 -F ./logs/enshrouded_server.log --pid=$ENS_PID",
		);
	});

	it("fixes multiple shell variables wrapped in brackets", () => {
		const input =
			"MY_VAR=$! ; echo {{MY_VAR}} ; OTHER=$(date) ; echo {{OTHER}}";
		const output = sanitizeStartupCommand(input);
		expect(output).toBe(
			"MY_VAR=$! ; echo $MY_VAR ; OTHER=$(date) ; echo $OTHER",
		);
	});

	it("does not touch real template variables without shell assignment", () => {
		const input =
			"java -Xmx{{MEMORY}}M -jar {{SERVER_JARFILE}}";
		const output = sanitizeStartupCommand(input);
		expect(output).toBe(input);
	});

	it("does not touch {{ENS_PID}} when there is no ENS_PID assignment", () => {
		const input = "echo {{ENS_PID}}";
		const output = sanitizeStartupCommand(input);
		expect(output).toBe(input);
	});

	it("returns empty string as-is", () => {
		expect(sanitizeStartupCommand("")).toBe("");
	});

	it("handles $0, $?, etc. style assignments", () => {
		const input = "EXIT_CODE=$? ; echo {{EXIT_CODE}}";
		const output = sanitizeStartupCommand(input);
		expect(output).toBe("EXIT_CODE=$? ; echo $EXIT_CODE");
	});
});
