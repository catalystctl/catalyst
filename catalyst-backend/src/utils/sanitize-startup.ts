/**
 * Sanitize a startup command from a Pterodactyl egg import.
 *
 * Some eggs mistakenly wrap shell variables (e.g. $ENS_PID) in template
 * brackets ({{ENS_PID}}). Since these are not actual template variables,
 * they are left unreplaced and break the startup command.
 *
 * Detects shell-variable assignments (VAR=$! or VAR=$(…)) and replaces
 * any corresponding {{VAR}} placeholders with $VAR.
 */

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeStartupCommand(startup: string): string {
	if (!startup) return startup;

	// Find shell variable assignments like: ENS_PID=$! or ENS_PID=$(cmd)
	const assignmentRe = /\b([A-Za-z_]\w*)=\$[!?0-9]|\b([A-Za-z_]\w*)=\$\(/g;
	let result = startup;
	let m: RegExpExecArray | null;

	// Use a Set to avoid duplicate replacements
	const varsToFix = new Set<string>();
	while ((m = assignmentRe.exec(startup)) !== null) {
		const varName = m[1] || m[2];
		if (varName) {
			varsToFix.add(varName);
		}
	}

	for (const varName of varsToFix) {
		const placeholder = new RegExp(`\\{\\{${escapeRegExp(varName)}\\}\\}`, "g");
		if (placeholder.test(result)) {
			result = result.replace(placeholder, `\$${varName}`);
		}
	}

	return result;
}
