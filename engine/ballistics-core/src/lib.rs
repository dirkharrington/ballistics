pub mod atmosphere;
pub mod ballistics;
pub mod drag;
pub mod types;

pub use ballistics::compute as compute_trajectory_internal;
pub use types::{Bullet, TrajectoryParams, TrajectoryPoint, TrajectoryResult};

#[cfg(feature = "ffi")]
pub mod ffi;
