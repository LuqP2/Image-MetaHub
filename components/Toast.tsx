import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, CircleAlert, Info, X } from 'lucide-react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
  variant?: 'success' | 'warning' | 'error' | 'info';
  detail?: string;
  action?: { label: string; onClick: () => void };
  prominent?: boolean;
}

const Toast: React.FC<ToastProps> = ({ message, onDismiss, duration = 3000, variant = 'success', detail, action, prominent = false }) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onDismiss]);

  const color = { success: 'border-green-700/60 text-green-400', warning: 'border-amber-600/60 text-amber-400', error: 'border-red-700/60 text-red-400', info: 'border-blue-700/60 text-blue-400' }[variant];
  const Icon = { success: CheckCircle2, warning: AlertTriangle, error: CircleAlert, info: Info }[variant];
  return (
    <div role={variant === 'success' || variant === 'info' ? 'status' : 'alert'} className={`fixed top-4 right-4 animate-slide-in-right ${prominent ? 'z-[13000]' : 'z-50'}`}>
      <div className={`${prominent ? 'bg-gray-950/95' : variant === 'success' ? 'bg-green-900/90' : 'bg-gray-950/95'} backdrop-blur-sm px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 min-w-[300px] max-w-[min(500px,calc(100vw-32px))] border ${color}`}>
        <Icon className="h-5 w-5 flex-shrink-0" />
        <div className="min-w-0 flex-1 text-sm text-gray-100"><span>{message}</span>{detail && <p className="mt-1 break-words text-xs text-gray-400">{detail}</p>}{action && <button className="mt-2 font-medium underline" onClick={action.onClick}>{action.label}</button>}</div>
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-gray-800 rounded transition-colors flex-shrink-0"
          title="Dismiss"
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default Toast;
