const _mockDestroy = jest.fn();
const _mockUpdate  = jest.fn();
const Chart = jest.fn().mockImplementation((_ctx, config) => ({
  destroy: _mockDestroy,
  update:  _mockUpdate,
  data:    config?.data ?? { datasets: [] },
  options: config?.options ?? {},
  plugins: config?.plugins ?? [],
}));
Chart.register = jest.fn();

module.exports = {
  Chart,
  _mockDestroy,
  _mockUpdate,
  LineController: {}, LineElement: {}, PointElement: {},
  LinearScale: {}, CategoryScale: {}, Decimation: {}, Tooltip: {}, Legend: {},
};
