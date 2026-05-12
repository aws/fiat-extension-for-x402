/**
 * Shared Logger for Agentic Pay Payment Flow
 * 
 * Provides centralized logging for Agentic Pay, service, and client
 * to create a complete, verifiable payment flow log.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, '../logs');
const FLOW_LOG_FILE = path.join(LOG_DIR, 'payment-flow.log');

export type AgentType = 'AGENTIC_PAY' | 'SERVICE' | 'CLIENT';

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Initialize the flow log (clear previous run)
 */
export function initFlowLog() {
  ensureLogDir();
  if (fs.existsSync(FLOW_LOG_FILE)) {
    fs.unlinkSync(FLOW_LOG_FILE);
  }
  const header = `
${'='.repeat(100)}
AGENTIC PAY PAYMENT FLOW LOG
Started: ${new Date().toISOString()}
${'='.repeat(100)}

`;
  fs.writeFileSync(FLOW_LOG_FILE, header);
}

/**
 * Log a message to the shared flow log
 */
export function logFlow(agent: AgentType, message: string) {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${agent.padEnd(7)}] ${message}\n`;
  fs.appendFileSync(FLOW_LOG_FILE, logEntry);
}

/**
 * Log an object with pretty formatting
 */
export function logFlowObject(agent: AgentType, label: string, obj: any) {
  const separator = '-'.repeat(80);
  logFlow(agent, separator);
  logFlow(agent, label);
  logFlow(agent, separator);
  const jsonStr = JSON.stringify(obj, null, 2);
  // Split by lines and log each line
  jsonStr.split('\n').forEach(line => {
    logFlow(agent, line);
  });
  logFlow(agent, separator);
}

/**
 * Log a step in the payment flow
 */
export function logFlowStep(agent: AgentType, step: number, description: string) {
  logFlow(agent, '');
  logFlow(agent, `>>> STEP ${step}: ${description}`);
  logFlow(agent, '');
}

/**
 * Log keys (public and private)
 */
export function logFlowKeys(agent: AgentType, label: string, keys: { publicKey?: any; privateKey?: any }) {
  logFlow(agent, '');
  logFlow(agent, `🔑 ${label}`);
  if (keys.publicKey) {
    logFlowObject(agent, 'Public Key (JWK)', keys.publicKey);
  }
  if (keys.privateKey) {
    logFlowObject(agent, 'Private Key (JWK)', keys.privateKey);
  }
}

/**
 * Log HTTP request
 */
export function logFlowRequest(agent: AgentType, method: string, url: string, headers?: any, body?: any) {
  logFlow(agent, '');
  logFlow(agent, `📤 HTTP ${method} ${url}`);
  if (headers) {
    logFlowObject(agent, 'Request Headers', headers);
  }
  if (body) {
    logFlowObject(agent, 'Request Body', body);
  }
}

/**
 * Log HTTP response
 */
export function logFlowResponse(agent: AgentType, status: number, headers?: any, body?: any) {
  logFlow(agent, '');
  logFlow(agent, `📥 HTTP Response ${status}`);
  if (headers) {
    logFlowObject(agent, 'Response Headers', headers);
  }
  if (body) {
    logFlowObject(agent, 'Response Body', body);
  }
}

/**
 * Log success
 */
export function logFlowSuccess(agent: AgentType, message: string) {
  logFlow(agent, '');
  logFlow(agent, `✅ ${message}`);
}

/**
 * Log error
 */
export function logFlowError(agent: AgentType, message: string, error?: any) {
  logFlow(agent, '');
  logFlow(agent, `❌ ${message}`);
  if (error) {
    logFlowObject(agent, 'Error Details', error);
  }
}
