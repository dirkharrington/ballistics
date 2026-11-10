package com.ballistics;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import com.ballistics.config.SecurityHeadersFilter;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Verifies WASM-related static asset headers (BE-3 / M6 + M7 of threat model):
 * - .wasm files served with Content-Type: application/wasm and immutable Cache-Control
 * - .js files under /assets/** carry the CSP header with 'wasm-unsafe-eval'
 *
 * <p>Fixtures are written to target/classes/static/assets/ in @BeforeAll so the
 * production /assets/** resource handler (which uses classpath:/static/assets/)
 * finds them on the first request. ClassPathResource does not cache resource
 * existence at context-creation time, so the write-before-test pattern is safe.</p>
 */
@SpringBootTest
class WasmAssetHeadersTest {

    private static final Path ASSETS_DIR =
        Paths.get("target/classes/static/assets");

    @BeforeAll
    static void stageTestFixtures() throws Exception {
        Files.createDirectories(ASSETS_DIR);
        Files.write(ASSETS_DIR.resolve("engine-test.wasm"),
            new byte[]{0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00});
        Files.write(ASSETS_DIR.resolve("engine-test.js"),
            "/* test fixture */\n".getBytes());
    }

    @AfterAll
    static void removeTestFixtures() throws Exception {
        Files.deleteIfExists(ASSETS_DIR.resolve("engine-test.wasm"));
        Files.deleteIfExists(ASSETS_DIR.resolve("engine-test.js"));
    }

    @Autowired WebApplicationContext wac;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(wac)
            .addFilter(new SecurityHeadersFilter())
            .build();
    }

    @Test
    void wasmFileServedWithApplicationWasmContentType() throws Exception {
        mvc.perform(get("/assets/engine-test.wasm"))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("application/wasm"));
    }

    @Test
    void wasmFileServedWithImmutableCacheControl() throws Exception {
        mvc.perform(get("/assets/engine-test.wasm"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", containsString("immutable")));
    }

    @Test
    void jsFileUnderAssetsCarriesCspWithWasmUnsafeEval() throws Exception {
        mvc.perform(get("/assets/engine-test.js"))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Security-Policy",
                containsString("'wasm-unsafe-eval'")));
    }
}
