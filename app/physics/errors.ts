export class TrajectoryInputError extends RangeError {
  override readonly name = 'TrajectoryInputError';
  readonly field: string;
  constructor(field: string, constraint: string) {
    super(`${field} must be ${constraint}`);
    this.field = field;
  }
}
