package com.ballistics;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Verifies that PWA static assets (favicon and manifest) are served correctly.
 */
@SpringBootTest
class StaticAssetTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    @Test
    void faviconSvgIsServed() throws Exception {
        mvc.perform(get("/favicon.svg"))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("image/svg+xml"));
    }

    @Test
    void manifestJsonIsServedWithCorrectContent() throws Exception {
        mvc.perform(get("/manifest.json"))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.containsString("Ballistics Visualizer")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("standalone")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("#00d4ff")));
    }

    @Test
    void appleTouchIconIsServed() throws Exception {
        mvc.perform(get("/apple-touch-icon.png"))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("image/png"));
    }
}
