package com.acat.crawler.service;

import com.acat.crawler.dto.CrawlResult;
import com.acat.crawler.dto.SearchResult;
import com.acat.crawler.entity.*;
import com.acat.crawler.mapper.*;
import com.acat.crawler.repository.ParagraphRepository;
import org.htmlunit.WebClient;
import org.htmlunit.html.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class CrawlerService {

    private final WebClient webClient;
    private final GoogleSearchService googleSearchService;
    private final BookMapper bookMapper;
    private final BookChapterMapper chapterMapper;
    private final BookAuthorMapper authorMapper;
    private final BookDictMapper dictMapper;
    private final BookDictDataMapper dictDataMapper;
    private final ParagraphRepository paragraphRepository;

    @Value("${crawler.base-url}")
    private String baseUrl;

    private static final Long CATEGORY_DICT_ID = 1L;
    private static final Long TAG_DICT_ID = 2L;
    private static final Long COVER_FILE_ID = 0L;

    // ==================== 搜索 ====================

    public List<SearchResult> search(String keyword, int page) throws IOException {
        return googleSearchService.search(keyword, page);
    }

    // ==================== 爬取 ====================

    public CrawlResult crawl(String bookUrl) {
        try {
            log.info("开始爬取书籍: {}", bookUrl);
            HtmlPage bookPage = webClient.getPage(bookUrl);
            webClient.waitForBackgroundJavaScript(3000);

            String title = getText(bookPage, "/html/body/div[2]/ul/li[1]/div[1]/div/div[2]/h1/a");
            String authorName = getText(bookPage, "/html/body/div[2]/ul/li[1]/div[1]/div/div[2]/p[1]/a");
            String coverUrl = getAttr(bookPage, "/html/body/div[2]/ul/li[1]/div[1]/div/div[1]/img", "src");
            String categoryName = getText(bookPage, "/html/body/div[2]/ul/li[1]/div[1]/div/div[2]/p[2]/a");
            String statusText = getText(bookPage, "/html/body/div[2]/ul/li[1]/div[1]/div/div[2]/p[3]");
            String introduction = getText(bookPage, "/html/body/div[2]/ul/li[1]/div[2]/div/div[2]/div/p[1]");

            if (introduction == null || introduction.isBlank()) {
                try {
                    List<?> expandLinks = bookPage.getByXPath("/html/body/div[2]/ul/li[1]/div[2]/ul/li[2]/a");
                    if (!expandLinks.isEmpty() && expandLinks.get(0) instanceof HtmlAnchor) {
                        ((HtmlAnchor) expandLinks.get(0)).click();
                        webClient.waitForBackgroundJavaScript(1000);
                        introduction = getText(bookPage, "/html/body/div[2]/ul/li[1]/div[2]/div/div[2]/div/p[1]");
                    }
                } catch (Exception ignored) {}
            }

            List<String> tags = new ArrayList<>();
            try {
                List<?> tagNodes = bookPage.getByXPath("/html/body/div[2]/ul/li[1]/div[2]/div[1]/ul/li");
                for (Object t : tagNodes) {
                    if (t instanceof HtmlListItem) {
                        String tagText = ((HtmlListItem) t).getTextContent().trim();
                        if (!tagText.isBlank()) tags.add(tagText);
                    }
                }
            } catch (Exception ignored) {}

            if (title == null || title.isBlank()) {
                return CrawlResult.builder().success(false).message("无法提取书籍标题").build();
            }

            log.info("书籍信息: title={}, author={}, category={}", title, authorName, categoryName);

            Long authorId = findOrCreateAuthor(authorName);
            if (categoryName != null && !categoryName.isBlank()) {
                findOrCreateDictData(CATEGORY_DICT_ID, categoryName);
            }
            for (String tag : tags) {
                findOrCreateDictData(TAG_DICT_ID, tag);
            }

            String bookStatus = parseStatus(statusText);
            BookEntity book = findOrCreateBook(title, authorId, categoryName, introduction, bookStatus);

            int chapterCount = crawlChapters(bookPage, book.getId());

            return CrawlResult.builder()
                    .success(true).message("爬取完成")
                    .title(title).author(authorName).category(categoryName)
                    .bookId(book.getId()).chapterCount(chapterCount).crawledChapters(chapterCount)
                    .build();

        } catch (Exception e) {
            log.error("爬取书籍失败: {}", bookUrl, e);
            return CrawlResult.builder().success(false).message("爬取失败: " + e.getMessage()).build();
        }
    }

    // ==================== 章节爬取 ====================

    private int crawlChapters(HtmlPage bookPage, Long bookId) {
        try {
            DomElement catalog = bookPage.getElementById("catalog");
            if (catalog == null) {
                log.warn("未找到目录元素 #catalog");
                return 0;
            }

            DomNodeList<HtmlElement> items = catalog.getElementsByTagName("li");
            int count = 0;
            int sortOrder = 1;

            for (HtmlElement liElem : items) {
                if (!(liElem instanceof HtmlListItem)) continue;
                HtmlListItem li = (HtmlListItem) liElem;
                DomNodeList<HtmlElement> anchors = li.getElementsByTagName("a");
                if (anchors.isEmpty()) continue;

                HtmlAnchor anchor = (HtmlAnchor) anchors.get(0);
                String chapterTitle = anchor.getTextContent().trim();
                String chapterUrl = anchor.getHrefAttribute();

                if (chapterTitle.isBlank()) continue;

                if (chapterUrl != null && !chapterUrl.startsWith("http")) {
                    chapterUrl = baseUrl + chapterUrl;
                }

                BookChapterEntity chapter = findOrCreateChapter(bookId, chapterTitle, sortOrder);

                if (chapterUrl != null && !chapterUrl.isBlank()) {
                    try {
                        List<String> paragraphs = crawlChapterContent(chapterUrl);
                        if (!paragraphs.isEmpty()) {
                            paragraphRepository.saveParagraphs(bookId, chapter.getId(), paragraphs);
                            int wordCount = paragraphs.stream().mapToInt(String::length).sum();
                            chapter.setWordCount(wordCount);
                            chapterMapper.updateById(chapter);
                        }
                    } catch (Exception e) {
                        log.warn("爬取章节内容失败: {} - {}", chapterTitle, e.getMessage());
                    }
                }

                count++;
                sortOrder++;
            }

            log.info("目录爬取完成: bookId={}, chapters={}", bookId, count);
            return count;

        } catch (Exception e) {
            log.error("爬取目录失败: bookId={}", bookId, e);
            return 0;
        }
    }

    // ==================== 章节内容爬取 ====================

    public List<String> crawlChapterContent(String chapterUrl) throws IOException {
        HtmlPage chapterPage = webClient.getPage(chapterUrl);
        webClient.waitForBackgroundJavaScript(2000);

        String contentXPath = "/html/body/div[2]/div[1]/div[3]";
        List<?> nodes = chapterPage.getByXPath(contentXPath);

        if (nodes.isEmpty()) return List.of();

        String fullText = ((HtmlElement) nodes.get(0)).getTextContent();
        if (fullText == null || fullText.isBlank()) return List.of();

        String[] parts = fullText.split("\n\n");
        List<String> paragraphs = new ArrayList<>();
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isBlank()) paragraphs.add(trimmed);
        }
        return paragraphs;
    }

    // ==================== 数据持久化 ====================

    @Transactional
    public Long findOrCreateAuthor(String name) {
        if (name == null || name.isBlank()) name = "佚名";

        BookAuthorEntity existing = authorMapper.selectOne(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<BookAuthorEntity>()
                        .eq(BookAuthorEntity::getName, name));
        if (existing != null) return existing.getId();

        BookAuthorEntity author = new BookAuthorEntity();
        author.setUserId(0L);
        author.setName(name);
        author.setStatus(1);
        authorMapper.insert(author);
        log.info("新增作者: {}", name);
        return author.getId();
    }

    @Transactional
    public Long findOrCreateDictData(Long dictId, String name) {
        if (name == null || name.isBlank()) return null;

        BookDictDataEntity existing = dictDataMapper.selectOne(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<BookDictDataEntity>()
                        .eq(BookDictDataEntity::getDictId, dictId)
                        .eq(BookDictDataEntity::getName, name));
        if (existing != null) return existing.getId();

        BookDictDataEntity data = new BookDictDataEntity();
        data.setDictId(dictId);
        data.setCode(name.toLowerCase().replaceAll("[^a-z0-9]", "_"));
        data.setName(name);
        data.setValue(name);
        data.setI18nCode("zh-CN");
        data.setSortOrder(0);
        data.setIsEnabled(1);
        dictDataMapper.insert(data);
        log.info("新增字典数据项: dictId={}, name={}", dictId, name);
        return data.getId();
    }

    @Transactional
    public BookEntity findOrCreateBook(String title, Long authorId, String category, String description, String status) {
        BookEntity existing = bookMapper.selectOne(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<BookEntity>()
                        .eq(BookEntity::getTitle, title)
                        .eq(BookEntity::getAuthorId, authorId));
        if (existing != null) {
            if (description != null && !description.isBlank()) existing.setDescription(description);
            if (category != null && !category.isBlank()) existing.setCategory(category);
            if (status != null) existing.setStatus(status);
            bookMapper.updateById(existing);
            return existing;
        }

        BookEntity book = new BookEntity();
        book.setTitle(title);
        book.setAuthorId(authorId);
        book.setCoverId(COVER_FILE_ID);
        book.setDescription(description);
        book.setCategory(category != null ? category : "");
        book.setStatus(status != null ? status : "ongoing");
        book.setWordCount(0L);
        book.setChapterCount(0);
        book.setRating(0.0);
        bookMapper.insert(book);
        log.info("新增书籍: title={}, authorId={}", title, authorId);
        return book;
    }

    @Transactional
    public BookChapterEntity findOrCreateChapter(Long bookId, String title, int sortOrder) {
        BookChapterEntity existing = chapterMapper.selectOne(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<BookChapterEntity>()
                        .eq(BookChapterEntity::getBookId, bookId)
                        .eq(BookChapterEntity::getTitle, title));
        if (existing != null) return existing;

        BookChapterEntity chapter = new BookChapterEntity();
        chapter.setBookId(bookId);
        chapter.setTitle(title);
        chapter.setWordCount(0);
        chapter.setSortOrder(sortOrder);
        chapterMapper.insert(chapter);
        return chapter;
    }

    // ==================== 工具方法 ====================

    private String parseStatus(String statusText) {
        if (statusText == null) return "ongoing";
        if (statusText.contains("完结") || statusText.contains("完本")) return "completed";
        return "ongoing";
    }

    private String getText(HtmlPage page, String xpath) {
        List<?> nodes = page.getByXPath(xpath);
        if (nodes.isEmpty()) return null;
        String text = ((HtmlElement) nodes.get(0)).getTextContent();
        return text != null ? text.trim() : null;
    }

    private String getAttr(HtmlPage page, String xpath, String attr) {
        List<?> nodes = page.getByXPath(xpath);
        if (nodes.isEmpty()) return null;
        return ((HtmlElement) nodes.get(0)).getAttribute(attr);
    }
}
