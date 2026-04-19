package com.ballistics.config;

import com.ballistics.model.Bullet;
import org.springframework.boot.context.properties.ConfigurationProperties;
import java.util.List;

@ConfigurationProperties("app")
public record BulletCatalogProperties(List<Bullet> bullets) {}
