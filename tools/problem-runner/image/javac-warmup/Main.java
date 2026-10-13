import java.util.*;
import java.util.function.*;
import java.util.stream.*;

/** Exercises the compiler paths a typed driver uses so the image's class-data archive covers them. */
class Solution {
  public List<List<Integer>> groups(int[] values, int width) {
    Map<Integer, List<Integer>> buckets = new TreeMap<>();
    for (int value : values) buckets.computeIfAbsent(value % width, key -> new ArrayList<>()).add(value);
    return buckets.values().stream().map(list -> list.stream().sorted(Comparator.reverseOrder()).collect(Collectors.toList())).collect(Collectors.toList());
  }
}

final class Pair<A, B> { final A first; final B second; Pair(A first, B second) { this.first = first; this.second = second; } }

@SuppressWarnings("unchecked")
public class Main {
  static Object decode(String text) {
    if (text.startsWith("[")) {
      ArrayList<Object> out = new ArrayList<>();
      for (String part : text.substring(1, text.length() - 1).split(",")) if (!part.isBlank()) out.add(Integer.parseInt(part.trim()));
      return out;
    }
    return Integer.parseInt(text.trim());
  }
  public static void main(String[] args) throws Exception {
    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8));
    List<String> lines = reader.lines().filter(line -> !line.isBlank()).collect(Collectors.toList());
    PriorityQueue<Pair<Integer, String>> queue = new PriorityQueue<>((x, y) -> Integer.compare(x.first, y.first));
    for (String line : lines) queue.add(new Pair<>(line.length(), line));
    StringBuilder out = new StringBuilder();
    while (!queue.isEmpty()) {
      Pair<Integer, String> next = queue.poll();
      Object value = decode(next.second);
      int[] values = value instanceof List ? ((List<Object>) value).stream().mapToInt(item -> (Integer) item).toArray() : new int[] { (Integer) value };
      BiFunction<int[], Integer, List<List<Integer>>> grouped = new Solution()::groups;
      out.append(grouped.apply(values, 3)).append('\n');
    }
    System.out.print(out);
  }
}
