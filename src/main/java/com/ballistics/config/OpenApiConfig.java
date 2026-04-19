package com.ballistics.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI ballisticsOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("Ballistics Visualizer API")
                .description("External ballistics calculator using G1 drag model with RK4 integration")
                .version("1.0.0"));
    }
}
