import React, { useMemo } from 'react';
import { X, TrendingUp, Image as ImageIcon, Calendar, HardDrive } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface AnalyticsProps {
  isOpen: boolean;
  onClose: () => void;
}

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#f43f5e'];

const Analytics: React.FC<AnalyticsProps> = ({ isOpen, onClose }) => {
  const images = useImageStore((state) => state.images);

  const analytics = useMemo(() => {
    if (!images || images.length === 0) {
      return null;
    }

    // Overview stats
    const totalImages = images.length;
    const generators = new Set<string>();
    const models = new Map<string, number>();
    const loras = new Map<string, number>();
    const samplers = new Map<string, number>();
    const resolutions = new Map<string, number>();
    const dates = new Map<string, number>(); // month -> count

    let firstImageDate = Infinity;
    let lastImageDate = 0;

    images.forEach((img) => {
      // Extract generator from metadata
      const generator = (img.metadata as any)?.generator || 'Unknown';
      generators.add(generator);

      // Count models
      img.models?.forEach((model) => {
        if (model) {
          models.set(model, (models.get(model) || 0) + 1);
        }
      });

      // Count loras
      img.loras?.forEach((lora) => {
        if (lora) {
          loras.set(lora, (loras.get(lora) || 0) + 1);
        }
      });

      // Count samplers/schedulers
      if (img.scheduler) {
        samplers.set(img.scheduler, (samplers.get(img.scheduler) || 0) + 1);
      }

      // Count resolutions
      if (img.dimensions && img.dimensions !== '0x0') {
        resolutions.set(img.dimensions, (resolutions.get(img.dimensions) || 0) + 1);
      }

      // Track dates
      if (img.lastModified) {
        const date = new Date(img.lastModified);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        dates.set(monthKey, (dates.get(monthKey) || 0) + 1);

        if (img.lastModified < firstImageDate) firstImageDate = img.lastModified;
        if (img.lastModified > lastImageDate) lastImageDate = img.lastModified;
      }
    });

    // Generator distribution
    const generatorCounts = new Map<string, number>();
    images.forEach((img) => {
      const generator = (img.metadata as any)?.generator || 'Unknown';
      generatorCounts.set(generator, (generatorCounts.get(generator) || 0) + 1);
    });

    const generatorData = Array.from(generatorCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Top models
    const topModels = Array.from(models.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top loras
    const topLoras = Array.from(loras.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top samplers
    const topSamplers = Array.from(samplers.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Resolution distribution (top 8)
    const resolutionData = Array.from(resolutions.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // Timeline data - sorted by month
    const timelineData = Array.from(dates.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      totalImages,
      totalGenerators: generators.size,
      firstImageDate: firstImageDate !== Infinity ? new Date(firstImageDate).toLocaleDateString() : 'N/A',
      lastImageDate: lastImageDate !== 0 ? new Date(lastImageDate).toLocaleDateString() : 'N/A',
      generatorData,
      topModels,
      topLoras,
      topSamplers,
      resolutionData,
      timelineData,
    };
  }, [images]);

  if (!isOpen) return null;

  if (!analytics || analytics.totalImages === 0) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-200">Analytics</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-700 transition-colors"
              title="Close"
            >
              <X size={24} />
            </button>
          </div>
          <p className="text-gray-400 text-center">No images available for analytics. Add some folders to get started!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="min-h-screen p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 mb-6 sticky top-4 z-10 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingUp size={32} className="text-blue-400" />
                <h2 className="text-3xl font-bold text-gray-200">Analytics Dashboard</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-gray-700 transition-colors hover:shadow-lg hover:shadow-accent/30"
                title="Close Analytics"
              >
                <X size={24} />
              </button>
            </div>
          </div>

          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <ImageIcon className="text-blue-400" size={24} />
                <h3 className="text-gray-400 text-sm font-medium">Total Images</h3>
              </div>
              <p className="text-3xl font-bold text-gray-200">{analytics.totalImages.toLocaleString()}</p>
            </div>

            <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <HardDrive className="text-purple-400" size={24} />
                <h3 className="text-gray-400 text-sm font-medium">Generators</h3>
              </div>
              <p className="text-3xl font-bold text-gray-200">{analytics.totalGenerators}</p>
            </div>

            <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="text-green-400" size={24} />
                <h3 className="text-gray-400 text-sm font-medium">First Image</h3>
              </div>
              <p className="text-xl font-bold text-gray-200">{analytics.firstImageDate}</p>
            </div>

            <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="text-orange-400" size={24} />
                <h3 className="text-gray-400 text-sm font-medium">Latest Image</h3>
              </div>
              <p className="text-xl font-bold text-gray-200">{analytics.lastImageDate}</p>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Generator Distribution */}
            {analytics.generatorData.length > 0 && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h3 className="text-xl font-bold text-gray-200 mb-4">Images by Generator</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.generatorData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" angle={-45} textAnchor="end" height={100} />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                      labelStyle={{ color: '#e5e7eb' }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Models */}
            {analytics.topModels.length > 0 && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 Models</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.topModels}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" angle={-45} textAnchor="end" height={100} />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                      labelStyle={{ color: '#e5e7eb' }}
                    />
                    <Bar dataKey="count" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top LoRAs */}
            {analytics.topLoras.length > 0 && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 LoRAs</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.topLoras}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" angle={-45} textAnchor="end" height={100} />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                      labelStyle={{ color: '#e5e7eb' }}
                    />
                    <Bar dataKey="count" fill="#ec4899" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Samplers */}
            {analytics.topSamplers.length > 0 && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h3 className="text-xl font-bold text-gray-200 mb-4">Top 10 Samplers</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.topSamplers}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" angle={-45} textAnchor="end" height={100} />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                      labelStyle={{ color: '#e5e7eb' }}
                    />
                    <Bar dataKey="count" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Resolution Distribution */}
            {analytics.resolutionData.length > 0 && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h3 className="text-xl font-bold text-gray-200 mb-4">Resolution Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={analytics.resolutionData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {analytics.resolutionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                      labelStyle={{ color: '#e5e7eb' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Timeline */}
            {analytics.timelineData.length > 0 && (
              <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h3 className="text-xl font-bold text-gray-200 mb-4">Images Created Over Time</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={analytics.timelineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" stroke="#9ca3af" angle={-45} textAnchor="end" height={80} />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                      labelStyle={{ color: '#e5e7eb' }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#06b6d4" strokeWidth={2} dot={{ fill: '#06b6d4' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
