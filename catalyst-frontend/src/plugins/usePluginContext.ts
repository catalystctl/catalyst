import { useContext } from 'react';
import { PluginContext } from './PluginContext';
import { reportSystemError } from '../services/api/systemErrors';

export function usePluginContext() {
  const context = useContext(PluginContext);
  if (!context) {
    reportSystemError({
      level: 'error',
      component: 'PluginProvider',
      message: 'usePluginContext must be used within PluginProvider',
      metadata: { context: 'usePluginContext invariant' },
    });
    throw new Error('usePluginContext must be used within PluginProvider');
  }
  return context;
}
