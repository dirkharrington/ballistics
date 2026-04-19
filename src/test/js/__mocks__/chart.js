const _mockDestroy = jest.fn();
const Chart = jest.fn().mockImplementation(() => ({ destroy: _mockDestroy }));
Chart.register = jest.fn();

module.exports = {
  Chart,
  _mockDestroy,
  LineController: {}, LineElement: {}, PointElement: {},
  LinearScale: {}, CategoryScale: {}, Tooltip: {}, Legend: {},
};
