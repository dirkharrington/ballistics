mod atmosphere;
mod ballistics;
mod drag;
mod types;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn hello_wasm() -> String {
    "ballistics-engine ok".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_wasm_returns_expected_string() {
        assert_eq!(hello_wasm(), "ballistics-engine ok");
    }
}
