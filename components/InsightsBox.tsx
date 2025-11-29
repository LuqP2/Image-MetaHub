import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { AutoInsight } from '../utils/analyticsUtils';

interface InsightsBoxProps {
  insights: AutoInsight[];
}

const InsightsBox: React.FC<InsightsBoxProps> = ({ insights }) => {
  if (insights.length === 0) {
    return null;
  }

  const getTrendIcon = (trend?: 'up' | 'down' | 'neutral') => {
    if (trend === 'up') {
      return <TrendingUp size={16} className="text-green-400" />;
    } else if (trend === 'down') {
      return <TrendingDown size={16} className="text-red-400" />;
    } else if (trend === 'neutral') {
      return <Minus size={16} className="text-gray-400" />;
    }
    return null;
  };

  return (
    <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
      <h3 className="text-xl font-bold text-gray-200 mb-4 flex items-center gap-2">
        <span>💡</span>
        <span>Key Insights</span>
      </h3>
      <div className="space-y-3">
        {insights.map((insight, index) => (
          <div
            key={index}
            className="flex items-start gap-3 p-3 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <span className="text-2xl flex-shrink-0">{insight.icon}</span>
            <div className="flex-1 flex items-center justify-between gap-3">
              <p className="text-gray-300 text-sm leading-relaxed">{insight.text}</p>
              {insight.trend && (
                <div className="flex-shrink-0">{getTrendIcon(insight.trend)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InsightsBox;
