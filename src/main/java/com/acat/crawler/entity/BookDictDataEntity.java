package com.acat.crawler.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_book_dict_data")
public class BookDictDataEntity {
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;
    private Long dictId;
    private Long parentId;
    private String code;
    private String name;
    private String value;
    private String i18nCode;
    private Integer sortOrder;
    private Integer isEnabled;
    private String description;

    @TableLogic
    @TableField(select = false)
    private Integer isDeleted;
    @TableField(fill = FieldFill.INSERT)
    private Long createBy;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Long updateBy;
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @Version
    @TableField(fill = FieldFill.INSERT)
    private Integer version;
}
