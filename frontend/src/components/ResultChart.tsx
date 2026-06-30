import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import type { QuestionOption } from '../types';

interface Props {
  options: QuestionOption[];
  totalResponses: number;
  compact?: boolean;
}

const COLORS = [
  '#4F46E5', '#7C3AED', '#0891B2', '#059669',
  '#D97706', '#DC2626', '#DB2777', '#65A30D',
];

export function ResultChart({ options, totalResponses, compact = false }: Props) {
  const data = options.map((opt) => ({
    label: opt.label,
    count: opt.count,
    pct: totalResponses > 0 ? Math.round((opt.count / totalResponses) * 100) : 0,
  }));

  const barHeight = compact ? 36 : 52;
  const chartHeight = Math.max(data.length * barHeight + 40, 120);
  const labelWidth = compact ? 90 : 130;

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: compact ? 60 : 80, bottom: 4, left: 8 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={labelWidth}
            tick={{ fontSize: compact ? 13 : 16, fill: compact ? '#374151' : '#F9FAFB' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value: number, _name: string, props: { payload?: { pct: number } }) => [
              `${value} 票 (${props.payload?.pct ?? 0}%)`,
              '作答數',
            ]}
            contentStyle={{ borderRadius: 8, fontSize: 14 }}
          />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={compact ? 28 : 40}>
            {data.map((_entry, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
            <LabelList
              dataKey="pct"
              position="right"
              formatter={(val: number) => `${val}%`}
              style={{ fontSize: compact ? 12 : 16, fontWeight: 600, fill: compact ? '#374151' : '#F9FAFB' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className={`text-center mt-1 ${compact ? 'text-xs text-gray-500' : 'text-sm text-gray-400'}`}>
        共 {totalResponses} 人作答
      </p>
    </div>
  );
}
