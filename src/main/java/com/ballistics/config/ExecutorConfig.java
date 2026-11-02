package com.ballistics.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.*;

@Configuration
public class ExecutorConfig {

    @Bean(name = "trajectoryExecutor", destroyMethod = "shutdown")
    public ExecutorService trajectoryExecutor() {
        return new ThreadPoolExecutor(
            4, 8,
            60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(100),
            new ThreadPoolExecutor.CallerRunsPolicy()
        );
    }
}
