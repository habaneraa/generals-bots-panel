import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import { init, use as registerECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

registerECharts([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  ToolboxComponent,
  CanvasRenderer,
]);

export { init };
