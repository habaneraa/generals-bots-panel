import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

registerECharts([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export { init };
