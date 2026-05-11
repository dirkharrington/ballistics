package com.ballistics;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

@SpringBootTest
class SecurityHeadersTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(wac).addFilter(
            new com.ballistics.config.SecurityHeadersFilter()).build();
    }

    @Test
    void securityHeadersPresentOnEveryResponse() throws Exception {
        mvc.perform(get("/actuator/health"))
            .andExpect(header().string("X-Content-Type-Options",  "nosniff"))
            .andExpect(header().string("X-Frame-Options",          "DENY"))
            .andExpect(header().string("X-XSS-Protection",         "0"))
            .andExpect(header().string("Referrer-Policy",           "strict-origin-when-cross-origin"))
            .andExpect(header().exists("Permissions-Policy"))
            .andExpect(header().exists("Strict-Transport-Security"))
            .andExpect(header().exists("Content-Security-Policy"));
    }

    @Test
    void cspSkippedForSwaggerPaths() throws Exception {
        // Swagger UI needs inline scripts; filter bypasses CSP for these paths.
        // In production the paths are disabled entirely (springdoc.swagger-ui.enabled=false).
        mvc.perform(get("/swagger-ui/index.html"))
            .andExpect(header().doesNotExist("Content-Security-Policy"));
    }

    @Test
    void cspSkippedForOpenApiDocs() throws Exception {
        mvc.perform(get("/v3/api-docs"))
            .andExpect(header().doesNotExist("Content-Security-Policy"));
    }
}
