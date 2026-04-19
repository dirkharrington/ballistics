package com.ballistics;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;

@SpringBootApplication
@EnableCaching
public class BallisticsApplication {
    public static void main(String[] args) {
        SpringApplication.run(BallisticsApplication.class, args);
    }
}
