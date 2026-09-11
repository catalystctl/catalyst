/**
 * Shell command the node deployment dialogs show for fetching the agent
 * install script. The agent API key must travel in the Authorization header:
 * the backend rejects `?apiKey=` so the long-lived key never lands in
 * reverse-proxy logs. `-f` stops an error response body (for example a 401
 * JSON) from being piped into bash and executed as a command.
 */
export function buildDeployCommand(deployUrl: string, apiKey: string): string {
  return `curl -fsSL -H 'Authorization: Bearer ${apiKey}' '${deployUrl}' | sudo bash -x`;
}
