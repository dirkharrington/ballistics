const _mockDestroy = jest.fn();
const _mockUpdate  = jest.fn();
const Chart = jest.fn().mockImplementation(() => ({ destroy: _mockDestroy, update: _mockUpdate }));
Chart.register = jest.fn();

module.exports = {
  Chart,
  _mockDestroy,
  _mockUpdate,
  LineController: {}, LineElement: {}, PointElement: {},
  LinearScale: {}, CategoryScale: {}, Tooltip: {}, Legend: {},
};
