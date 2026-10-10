//! Byte ranges for WebKit audio playback. Content stays decrypted in memory.
pub fn byte_range(header: &str, len: usize) -> Option<(usize, usize)> {
    let range = header.strip_prefix("bytes=")?;
    if range.contains(',') || len == 0 {
        return None;
    }
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<usize>().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((len.saturating_sub(suffix), len - 1));
    }
    let start = start.parse::<usize>().ok()?;
    let end = if end.is_empty() {
        len - 1
    } else {
        end.parse::<usize>().ok()?.min(len - 1)
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::byte_range;
    #[test]
    fn supports_webkit_probe_and_seek_ranges() {
        assert_eq!(byte_range("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(byte_range("bytes=50-", 100), Some((50, 99)));
        assert_eq!(byte_range("bytes=-20", 100), Some((80, 99)));
        assert_eq!(byte_range("bytes=90-1000", 100), Some((90, 99)));
    }
    #[test]
    fn rejects_invalid_or_multiple_ranges() {
        for range in [
            "bytes=100-",
            "bytes=9-2",
            "bytes=-0",
            "bytes=0-1,3-5",
            "bytes=bad-",
            "items=1-2",
        ] {
            assert_eq!(byte_range(range, 100), None);
        }
        assert_eq!(byte_range("bytes=0-1", 0), None);
    }
}
