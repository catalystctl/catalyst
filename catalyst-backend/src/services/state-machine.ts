/**
 * Server State Machine
 * Manages server lifecycle state transitions with validation
 */

import { ServerState } from "../shared-types";

export interface StateTransition {
  from: ServerState;
  to: ServerState;
  allowed: boolean;
  reason?: string;
}

export class ServerStateMachine {
  // Define allowed state transitions
  private static readonly TRANSITIONS: Map<ServerState, ServerState[]> = new Map([
    [
      ServerState.STOPPED,
      [ServerState.INSTALLING, ServerState.STARTING, ServerState.ERROR, ServerState.SUSPENDED, ServerState.ARCHIVED],
    ],
    [ServerState.INSTALLING, [ServerState.STOPPED, ServerState.ERROR]],
    [
      ServerState.STARTING,
      [ServerState.RUNNING, ServerState.ERROR, ServerState.STOPPED, ServerState.SUSPENDED],
    ],
    [
      ServerState.RUNNING,
      [ServerState.STOPPING, ServerState.CRASHED, ServerState.ERROR, ServerState.SUSPENDED, ServerState.INSTALLING],
    ],
    [ServerState.STOPPING, [ServerState.STOPPED, ServerState.ERROR]],
    [ServerState.CRASHED, [ServerState.STARTING, ServerState.STOPPED, ServerState.INSTALLING]],
    [ServerState.SUSPENDED, [ServerState.STOPPED, ServerState.STARTING, ServerState.ERROR]],
    [ServerState.ARCHIVED, [ServerState.STOPPED, ServerState.ERROR]],
    [ServerState.ERROR, [ServerState.STOPPED, ServerState.INSTALLING, ServerState.STARTING, ServerState.STOPPING]],
  ]);

  /**
   * Validate if a state transition is allowed
   */
  static canTransition(from: ServerState, to: ServerState): boolean {
    const allowedStates = this.TRANSITIONS.get(from);
    return allowedStates ? allowedStates.includes(to) : false;
  }

  /**
   * Get all allowed next states for a given state
   */
  static getAllowedTransitions(from: ServerState): ServerState[] {
    return this.TRANSITIONS.get(from) || [];
  }

  /**
   * Validate and get transition details
   */
  static validateTransition(from: ServerState, to: ServerState): StateTransition {
    const allowed = this.canTransition(from, to);
    return {
      from,
      to,
      allowed,
      reason: allowed ? undefined : `Cannot transition from ${from} to ${to}`,
    };
  }

  /**
   * Check if server can be started
   */
  static canStart(currentState: ServerState): boolean {
    return [ServerState.STOPPED, ServerState.CRASHED, ServerState.SUSPENDED, ServerState.ERROR].includes(currentState);
  }

  /**
   * Check if server can be stopped
   */
  static canStop(currentState: ServerState): boolean {
    return [ServerState.RUNNING, ServerState.STARTING, ServerState.ERROR, ServerState.CRASHED].includes(currentState);
  }

  /**
   * Check if server can be restarted
   */
  static canRestart(currentState: ServerState): boolean {
    return [ServerState.RUNNING, ServerState.STOPPED, ServerState.ERROR, ServerState.CRASHED].includes(currentState);
  }

  /**
   * Check if server is in a terminal error state
   */
  static isErrorState(state: ServerState): boolean {
    return [ServerState.ERROR, ServerState.CRASHED].includes(state);
  }

  /**
   * Check if server is running or operational
   */
  static isRunning(state: ServerState): boolean {
    return state === ServerState.RUNNING;
  }

  /**
   * Check if server is transitioning
   */
  static isTransitioning(state: ServerState): boolean {
    return [ServerState.STARTING, ServerState.STOPPING].includes(state);
  }
}
