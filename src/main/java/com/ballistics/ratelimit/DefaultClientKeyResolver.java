package com.ballistics.ratelimit;

import com.ballistics.config.RateLimitProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.regex.Pattern;

/**
 * Default {@link ClientKeyResolver}: normalises {@code request.getRemoteAddr()} into a
 * stable bucket key.
 *
 * <p>Tomcat's {@code RemoteIpValve} (enabled by {@code server.forward-headers-strategy=native})
 * has already unwrapped {@code X-Forwarded-For} when the TCP peer matches
 * {@code internal-proxies}. This class only reads {@code request.getRemoteAddr()}.</p>
 *
 * <p>Output format:
 * <ul>
 *   <li>{@code "v4:1.2.3.4"} — IPv4</li>
 *   <li>{@code "v4:1.2.3.4"} — IPv4-mapped IPv6 (::ffff:1.2.3.4)</li>
 *   <li>{@code "v6:2001:0db8::/48"} — IPv6 folded to the configured prefix</li>
 *   <li>{@code "unknown"} — null, hostname-like, or parse failure (shared bucket, fails closed)</li>
 * </ul>
 */
@Component
public class DefaultClientKeyResolver implements ClientKeyResolver {

    private static final Pattern ADDR_PATTERN =
        Pattern.compile("^[0-9A-Fa-f:.]{2,45}$");

    private final int ipv6PrefixLength;

    public DefaultClientKeyResolver(RateLimitProperties props) {
        this.ipv6PrefixLength = props.ipv6PrefixLength();
    }

    @Override
    public String resolve(HttpServletRequest request) {
        String addr = request.getRemoteAddr();
        if (addr == null || !ADDR_PATTERN.matcher(addr).matches()) {
            return "unknown";
        }
        try {
            InetAddress ip = InetAddress.getByName(addr);
            if (ip instanceof Inet4Address) {
                return "v4:" + ip.getHostAddress();
            }
            if (ip instanceof Inet6Address) {
                byte[] bytes = ip.getAddress();
                if (isIPv4Mapped(bytes)) {
                    byte[] ipv4 = new byte[]{bytes[12], bytes[13], bytes[14], bytes[15]};
                    return "v4:" + InetAddress.getByAddress(ipv4).getHostAddress();
                }
                return "v6:" + prefixHex(bytes, ipv6PrefixLength) + "/" + ipv6PrefixLength;
            }
            return "unknown";
        } catch (UnknownHostException e) {
            return "unknown";
        }
    }

    private static boolean isIPv4Mapped(byte[] bytes) {
        if (bytes.length != 16) return false;
        for (int i = 0; i < 10; i++) if (bytes[i] != 0) return false;
        return bytes[10] == (byte) 0xFF && bytes[11] == (byte) 0xFF;
    }

    /** Zeros bits beyond {@code prefixBits} and encodes as colon-separated 16-bit hex groups. */
    static String prefixHex(byte[] bytes, int prefixBits) {
        byte[] masked = bytes.clone();
        int fullBytes = prefixBits / 8;
        int partialBit = prefixBits % 8;
        if (partialBit != 0) {
            int mask = 0xFF << (8 - partialBit) & 0xFF;
            masked[fullBytes] = (byte) (masked[fullBytes] & mask);
        }
        for (int i = fullBytes + (partialBit > 0 ? 1 : 0); i < masked.length; i++) {
            masked[i] = 0;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 16; i += 2) {
            if (i > 0) sb.append(':');
            sb.append(String.format("%02x%02x", masked[i] & 0xFF, masked[i + 1] & 0xFF));
        }
        return sb.toString();
    }
}
