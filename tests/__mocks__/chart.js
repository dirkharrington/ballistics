const _mockDestroy = jest.fn();
const _mockUpdate  = jest.fn();
const _mockDraw    = jest.fn();
const Chart = jest.fn().mockImplementation((_ctx, config) => ({
  destroy: _mockDestroy,
  update:  _mockUpdate,
  draw:    _mockDraw,
  data:    config?.data ?? { datasets: [] },
  options: config?.options ?? {},
  plugins: config?.plugins ?? [],
}));
Chart.register = jest.fn();

module.exports = {
  Chart,
  _mockDestroy,
  _mockUpdate,
  _mockDraw,
  LineController: {}, LineElement: {}, PointElement: {},
  LinearScale: {}, CategoryScale: {}, Decimation: {}, Tooltip: {}, Legend: {},
};
