package com.ballistics.config;

import com.ballistics.model.Bullet;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Configuration
public class BulletCatalogConfig {

    @Bean
    public List<Bullet> bulletCatalog(BulletCatalogProperties props) {
        return List.copyOf(props.bullets());
    }

    @Bean
    public Map<String, Bullet> bulletCatalogMap(List<Bullet> bulletCatalog) {
        return bulletCatalog.stream()
            .collect(Collectors.toUnmodifiableMap(Bullet::id, Function.identity()));
    }
}
